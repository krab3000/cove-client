#include "pch.h"

#include "VlcRenderer.h"

#include <winrt/Microsoft.Graphics.DirectX.h>

#include <algorithm>
#include <string>

namespace Composition = winrt::Microsoft::UI::Composition;
namespace DX = winrt::Microsoft::Graphics::DirectX;

namespace ReactNativeVlc {

namespace {

winrt::com_ptr<ID3D11Device> CreateDevice() {
  // BGRA support is required by composition; video support by VLC's D3D11VA decoder.
  UINT flags = D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  winrt::com_ptr<ID3D11Device> device;
  winrt::check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels,
                                         ARRAYSIZE(levels), D3D11_SDK_VERSION, device.put(), nullptr, nullptr));
  return device;
}

// The context mutex, held for a scope.
struct ContextLock {
  explicit ContextLock(HANDLE mutex) : m_mutex(mutex) { WaitForSingleObject(m_mutex, INFINITE); }
  ~ContextLock() { ReleaseMutex(m_mutex); }
  HANDLE m_mutex;
};

// The module's attach function, from the plugin libVLC loads too (plugins\video_output beside libvlc.dll).
vlc_d3d11_host_attach_fn AttachFunction() {
  static const vlc_d3d11_host_attach_fn attach = []() -> vlc_d3d11_host_attach_fn {
    wchar_t path[MAX_PATH];
    const HMODULE libvlc = GetModuleHandleW(L"libvlc.dll");
    const DWORD length = libvlc ? GetModuleFileNameW(libvlc, path, MAX_PATH) : 0;
    if (length == 0 || length >= MAX_PATH)
      return nullptr;
    std::wstring plugin(path, length);
    plugin.resize(plugin.find_last_of(L'\\') + 1);
    plugin += L"plugins\\video_output\\libd3d11_host_plugin.dll";
    // It imports libvlccore.dll, which is beside libvlc.dll (already loaded).
    const HMODULE module = LoadLibraryExW(plugin.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS |
                                                                       LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR);
    return module ? reinterpret_cast<vlc_d3d11_host_attach_fn>(GetProcAddress(module, VLC_D3D11_HOST_ATTACH))
                  : nullptr;
  }();
  return attach;
}

} // namespace

VlcRenderer::VlcRenderer(const Composition::Compositor &compositor) : m_device(CreateDevice()) {
  m_callbacks.version = VLC_D3D11_HOST_VERSION;
  m_callbacks.opaque = this;
  m_callbacks.setup = Setup;
  m_callbacks.cleanup = Cleanup;
  m_callbacks.set_report_size = SetReportSize;
  m_callbacks.update_output = UpdateOutput;
  m_callbacks.make_current = MakeCurrent;
  m_callbacks.select_plane = SelectPlane;
  m_callbacks.swap = Swap;

  m_device->GetImmediateContext(m_context.put());
  // VLC's decoder and renderer, and composition (BeginDraw), all use the immediate context.
  m_context.as<ID3D10Multithread>()->SetMultithreadProtected(TRUE);
  m_contextMutex = CreateMutexW(nullptr, FALSE, nullptr);
  winrt::check_bool(m_contextMutex != nullptr);

  winrt::check_hresult(compositor.as<Composition::ICompositorInterop>()->CreateGraphicsDevice(m_device.get(),
                                                                                              &m_graphicsDevice));
  m_surface = m_graphicsDevice.CreateDrawingSurface2({int32_t(m_surfaceSize[0]), int32_t(m_surfaceSize[1])},
                                                     DX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
                                                     DX::DirectXAlphaMode::Ignore);
  m_surfaceInterop = m_surface.as<Composition::ICompositionDrawingSurfaceInterop>();
  Clear();
}

VlcRenderer::~VlcRenderer() {
  CloseHandle(m_contextMutex);
}

bool VlcRenderer::Attach(libvlc_media_player_t *player) {
  const auto attach = AttachFunction();
  return attach && attach(player, &m_callbacks) == 0;
}

void VlcRenderer::Resize(unsigned width, unsigned height) {
  width = std::clamp(width, 1u, 16384u);
  height = std::clamp(height, 1u, 16384u);
  std::lock_guard lock(m_sizeLock);
  m_viewSize[0] = width;
  m_viewSize[1] = height;
  if (m_reportSize)
    m_reportSize(m_reportOpaque, width, height);
}

void VlcRenderer::Clear() {
  try {
    Present(true);
  } catch (const winrt::hresult_error &) {
    // the surface comes back on the next frame
  }
}

bool VlcRenderer::Setup(void *opaque, vlc_d3d11_host_device_t *out) {
  auto self = static_cast<VlcRenderer *>(opaque);
  out->device_context = self->m_context.get();
  out->context_mutex = self->m_contextMutex;
  // Held for VLC until Cleanup.
  self->m_context->AddRef();
  return true;
}

void VlcRenderer::Cleanup(void *opaque) {
  auto self = static_cast<VlcRenderer *>(opaque);
  ContextLock lock(self->m_contextMutex);
  self->m_rtv = nullptr;
  self->m_texture = nullptr;
  self->m_textureSize[0] = self->m_textureSize[1] = 0;
  self->m_context->Release();
}

void VlcRenderer::SetReportSize(void *opaque, vlc_d3d11_host_report_size_cb report, void *reportOpaque) {
  auto self = static_cast<VlcRenderer *>(opaque);
  std::lock_guard lock(self->m_sizeLock);
  self->m_reportSize = report;
  self->m_reportOpaque = reportOpaque;
  if (report && self->m_viewSize[0])
    report(reportOpaque, self->m_viewSize[0], self->m_viewSize[1]);
}

bool VlcRenderer::UpdateOutput(void *opaque, const vlc_d3d11_host_render_cfg_t *cfg,
                               vlc_d3d11_host_output_cfg_t *out) {
  auto self = static_cast<VlcRenderer *>(opaque);
  const UINT width = std::clamp(cfg->width, 1u, 16384u);
  const UINT height = std::clamp(cfg->height, 1u, 16384u);
  {
    ContextLock lock(self->m_contextMutex);
    if (width != self->m_textureSize[0] || height != self->m_textureSize[1] || !self->m_texture) {
      self->m_rtv = nullptr;
      self->m_texture = nullptr;
      D3D11_TEXTURE2D_DESC desc{};
      desc.Width = width;
      desc.Height = height;
      desc.MipLevels = 1;
      desc.ArraySize = 1;
      desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
      desc.SampleDesc.Count = 1;
      desc.Usage = D3D11_USAGE_DEFAULT;
      desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
      if (FAILED(self->m_device->CreateTexture2D(&desc, nullptr, self->m_texture.put())))
        return false;
      D3D11_RENDER_TARGET_VIEW_DESC rtvDesc{};
      rtvDesc.Format = desc.Format;
      rtvDesc.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2D;
      if (FAILED(self->m_device->CreateRenderTargetView(self->m_texture.get(), &rtvDesc, self->m_rtv.put()))) {
        self->m_texture = nullptr;
        return false;
      }
      self->m_textureSize[0] = width;
      self->m_textureSize[1] = height;
    }
  }
  // SDR BT.709 output: VLC converts and tone maps everything (HDR10, HLG, BT.2020) to it.
  out->dxgi_format = DXGI_FORMAT_B8G8R8A8_UNORM;
  out->full_range = true;
  out->colorspace = VLC_D3D11_HOST_SPACE_BT709;
  out->primaries = VLC_D3D11_HOST_PRIMARIES_BT709;
  out->transfer = VLC_D3D11_HOST_TRANSFER_SRGB;
  return true;
}

bool VlcRenderer::MakeCurrent(void *, bool) {
  return true; // VLC fills the whole target (black around the picture)
}

bool VlcRenderer::SelectPlane(void *opaque, size_t plane, ID3D11RenderTargetView **output) {
  auto self = static_cast<VlcRenderer *>(opaque);
  if (plane != 0 || !self->m_rtv)
    return false;
  *output = self->m_rtv.get();
  return true;
}

void VlcRenderer::Swap(void *opaque) {
  auto self = static_cast<VlcRenderer *>(opaque);
  try {
    self->Present(false);
  } catch (const winrt::hresult_error &) {
    return; // a lost frame (device removed, surface resizing): the next one draws again
  }
  if (self->m_frameWanted.exchange(false) && self->m_onFrame)
    self->m_onFrame();
}

void VlcRenderer::Present(bool clear) {
  ContextLock lock(m_contextMutex);
  if (!clear && !m_texture)
    return;
  // The surface follows the size VLC renders at (clear: keep it).
  if (!clear && (m_surfaceSize[0] != m_textureSize[0] || m_surfaceSize[1] != m_textureSize[1])) {
    winrt::check_hresult(m_surfaceInterop->Resize({LONG(m_textureSize[0]), LONG(m_textureSize[1])}));
    m_surfaceSize[0] = m_textureSize[0];
    m_surfaceSize[1] = m_textureSize[1];
  }
  winrt::com_ptr<ID3D11Texture2D> target;
  POINT offset{};
  winrt::check_hresult(m_surfaceInterop->BeginDraw(nullptr, IID_PPV_ARGS(target.put()), &offset));
  if (clear) {
    // Only our region: the target is a shared atlas.
    winrt::com_ptr<ID3D11RenderTargetView> rtv;
    if (SUCCEEDED(m_device->CreateRenderTargetView(target.get(), nullptr, rtv.put()))) {
      const float black[4] = {0, 0, 0, 1};
      const D3D11_RECT rect{offset.x, offset.y, offset.x + LONG(m_surfaceSize[0]), offset.y + LONG(m_surfaceSize[1])};
      m_context.as<ID3D11DeviceContext1>()->ClearView(rtv.get(), black, &rect, 1);
    }
  } else {
    const D3D11_BOX box{0, 0, 0, m_textureSize[0], m_textureSize[1], 1};
    m_context->CopySubresourceRegion(target.get(), 0, UINT(offset.x), UINT(offset.y), 0, m_texture.get(), 0, &box);
  }
  winrt::check_hresult(m_surfaceInterop->EndDraw());
}

} // namespace ReactNativeVlc
