#include "pch.h"

#include "VlcRenderer.h"

#include <winrt/Microsoft.Graphics.DirectX.h>

#include <algorithm>

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

} // namespace

VlcRenderer::VlcRenderer(const Composition::Compositor &compositor) : m_device(CreateDevice()) {
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

void VlcRenderer::Attach(libvlc_media_player_t *player) {
  libvlc_video_set_output_callbacks(player, libvlc_video_engine_d3d11, Setup, Cleanup, SetWindow, UpdateOutput, Swap,
                                    MakeCurrent, nullptr, nullptr, SelectPlane, this);
}

void VlcRenderer::Resize(unsigned width, unsigned height) {
  width = std::clamp(width, 1u, 16384u);
  height = std::clamp(height, 1u, 16384u);
  std::lock_guard lock(m_sizeLock);
  m_viewSize[0] = width;
  m_viewSize[1] = height;
  if (m_reportSizeChange)
    m_reportSizeChange(m_reportOpaque, width, height);
}

void VlcRenderer::Clear() {
  try {
    Present(true);
  } catch (const winrt::hresult_error &) {
    // the surface comes back on the next frame
  }
}

bool VlcRenderer::Setup(void **opaque, const libvlc_video_setup_device_cfg_t *, libvlc_video_setup_device_info_t *out) {
  auto self = static_cast<VlcRenderer *>(*opaque);
  out->u.d3d11.device_context = self->m_context.get();
  out->u.d3d11.context_mutex = self->m_contextMutex;
  // Held for VLC until Cleanup (as in VLC's d3d11_player sample).
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

void VlcRenderer::SetWindow(void *opaque, libvlc_video_output_resize_cb reportSizeChange,
                            libvlc_video_output_mouse_move_cb, libvlc_video_output_mouse_press_cb,
                            libvlc_video_output_mouse_release_cb, void *reportOpaque) {
  auto self = static_cast<VlcRenderer *>(opaque);
  std::lock_guard lock(self->m_sizeLock);
  self->m_reportSizeChange = reportSizeChange;
  self->m_reportOpaque = reportOpaque;
  if (reportSizeChange && self->m_viewSize[0])
    reportSizeChange(reportOpaque, self->m_viewSize[0], self->m_viewSize[1]);
}

bool VlcRenderer::UpdateOutput(void *opaque, const libvlc_video_render_cfg_t *cfg, libvlc_video_output_cfg_t *out) {
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
  out->u.dxgi_format = DXGI_FORMAT_B8G8R8A8_UNORM;
  out->full_range = true;
  out->colorspace = libvlc_video_colorspace_BT709;
  out->primaries = libvlc_video_primaries_BT709;
  out->transfer = libvlc_video_transfer_func_SRGB;
  out->orientation = libvlc_video_orient_top_left;
  return true;
}

bool VlcRenderer::MakeCurrent(void *opaque, bool enter) {
  auto self = static_cast<VlcRenderer *>(opaque);
  if (enter && self->m_rtv) {
    // VLC draws the picture and its letterbox only; start from black.
    const float black[4] = {0, 0, 0, 1};
    self->m_context->ClearRenderTargetView(self->m_rtv.get(), black);
  }
  return true;
}

bool VlcRenderer::SelectPlane(void *opaque, size_t plane, void *output) {
  auto self = static_cast<VlcRenderer *>(opaque);
  if (plane != 0 || !self->m_rtv)
    return false;
  *static_cast<ID3D11RenderTargetView **>(output) = self->m_rtv.get();
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
