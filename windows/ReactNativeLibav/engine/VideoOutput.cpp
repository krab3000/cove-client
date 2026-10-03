#include "pch.h"

#include "VideoOutput.h"

#include <winrt/Microsoft.Graphics.DirectX.h>

#include <algorithm>

namespace ReactNativeLibav {

namespace Composition = winrt::Microsoft::UI::Composition;
namespace DirectX = winrt::Microsoft::Graphics::DirectX;

namespace {

winrt::com_ptr<ID3D11Device> CreateDevice() {
  // BGRA support is required by composition; video support by D3D11VA and the video processor.
  UINT flags = D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  winrt::com_ptr<ID3D11Device> device;
  HRESULT hr = E_FAIL;
#ifdef _DEBUG
  hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags | D3D11_CREATE_DEVICE_DEBUG, levels,
                         ARRAYSIZE(levels), D3D11_SDK_VERSION, device.put(), nullptr, nullptr);
#endif
  if (FAILED(hr)) // no debug layer installed, or release
    hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels, ARRAYSIZE(levels),
                           D3D11_SDK_VERSION, device.put(), nullptr, nullptr);
  winrt::check_hresult(hr);
  return device;
}

DXGI_COLOR_SPACE_TYPE InputColorSpace(const AVFrame *f) {
  const bool full = f->color_range == AVCOL_RANGE_JPEG;
  switch (f->colorspace) {
    case AVCOL_SPC_BT2020_NCL:
    case AVCOL_SPC_BT2020_CL:
      if (f->color_trc == AVCOL_TRC_SMPTE2084)
        return DXGI_COLOR_SPACE_YCBCR_STUDIO_G2084_LEFT_P2020;
      if (f->color_trc == AVCOL_TRC_ARIB_STD_B67)
        return DXGI_COLOR_SPACE_YCBCR_STUDIO_GHLG_TOPLEFT_P2020;
      return full ? DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P2020 : DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P2020;
    case AVCOL_SPC_BT470BG:
    case AVCOL_SPC_SMPTE170M:
      return full ? DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P601 : DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P601;
    case AVCOL_SPC_BT709:
      return full ? DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P709 : DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709;
    default: // unspecified: guess from the size, like most players
      if (f->height >= 720)
        return full ? DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P709 : DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709;
      return full ? DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P601 : DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P601;
  }
}

} // namespace

VideoOutput::VideoOutput(const Composition::Compositor &compositor) {
  m_device = CreateDevice();
  winrt::com_ptr<ID3D11DeviceContext> context;
  m_device->GetImmediateContext(context.put());
  m_context = context.as<ID3D11DeviceContext1>();
  // The decoder thread, the render thread and composition (BeginDraw) all use the immediate context.
  m_context.as<ID3D10Multithread>()->SetMultithreadProtected(TRUE);
  m_videoDevice = m_device.as<ID3D11VideoDevice>();
  m_videoContext = m_context.as<ID3D11VideoContext>();
  m_videoContext1 = m_context.try_as<ID3D11VideoContext1>();

  winrt::check_hresult(compositor.as<Composition::ICompositorInterop>()->CreateGraphicsDevice(m_device.get(),
                                                                                              &m_graphicsDevice));
  m_surface = m_graphicsDevice.CreateDrawingSurface2({int32_t(m_width), int32_t(m_height)},
                                                     DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized,
                                                     DirectX::DirectXAlphaMode::Ignore);
  m_surfaceInterop = m_surface.as<Composition::ICompositionDrawingSurfaceInterop>();
  Present(nullptr);
}

VideoOutput::~VideoOutput() = default;

void VideoOutput::Resize(uint32_t width, uint32_t height) noexcept {
  width = std::clamp<uint32_t>(width, 1, 16384);
  height = std::clamp<uint32_t>(height, 1, 16384);
  m_pendingSize.store((uint64_t(width) << 32) | height);
}

void VideoOutput::ApplyResize() {
  const uint64_t size = m_pendingSize.exchange(0);
  if (!size)
    return;
  const UINT width = UINT(size >> 32), height = UINT(size & 0xffffffff);
  if (width == m_width && height == m_height)
    return;
  winrt::check_hresult(m_surfaceInterop->Resize({LONG(width), LONG(height)}));
  m_width = width;
  m_height = height;
}

void VideoOutput::ResetCaches() {
  std::lock_guard lock(m_lock);
  m_inputViews.clear();
  if (m_hdr)
    m_hdr->Reset();
}

bool VideoOutput::EnsureProcessor(UINT inWidth, UINT inHeight) {
  if (m_processor && m_processorIn[0] == inWidth && m_processorIn[1] == inHeight && m_processorOut[0] == m_width &&
      m_processorOut[1] == m_height)
    return true;
  m_processor = nullptr;
  m_enumerator = nullptr;
  m_inputViews.clear();

  D3D11_VIDEO_PROCESSOR_CONTENT_DESC content{};
  content.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
  content.InputWidth = inWidth;
  content.InputHeight = inHeight;
  content.OutputWidth = m_width;
  content.OutputHeight = m_height;
  content.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
  if (FAILED(m_videoDevice->CreateVideoProcessorEnumerator(&content, m_enumerator.put())) ||
      FAILED(m_videoDevice->CreateVideoProcessor(m_enumerator.get(), 0, m_processor.put()))) {
    m_processor = nullptr;
    m_enumerator = nullptr;
    return false;
  }
  m_processorIn[0] = inWidth;
  m_processorIn[1] = inHeight;
  m_processorOut[0] = m_width;
  m_processorOut[1] = m_height;
  // No automatic processing (denoise, edge enhancement, ...): just colour conversion and scaling.
  m_videoContext->VideoProcessorSetStreamAutoProcessingMode(m_processor.get(), 0, FALSE);
  m_videoContext->VideoProcessorSetStreamFrameFormat(m_processor.get(), 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
  return true;
}

ID3D11Texture2D *VideoOutput::Upload(const AVFrame *frame) {
  const UINT width = UINT(frame->width) & ~1u, height = UINT(frame->height) & ~1u;
  if (!m_upload || m_uploadSize[0] != width || m_uploadSize[1] != height) {
    D3D11_TEXTURE2D_DESC desc{};
    desc.Width = width;
    desc.Height = height;
    desc.MipLevels = 1;
    desc.ArraySize = 1;
    desc.Format = DXGI_FORMAT_NV12;
    desc.SampleDesc.Count = 1;
    desc.Usage = D3D11_USAGE_STAGING;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    m_staging = nullptr;
    m_upload = nullptr;
    winrt::check_hresult(m_device->CreateTexture2D(&desc, nullptr, m_staging.put()));
    desc.Usage = D3D11_USAGE_DEFAULT;
    desc.CPUAccessFlags = 0;
    desc.BindFlags = D3D11_BIND_RENDER_TARGET;
    winrt::check_hresult(m_device->CreateTexture2D(&desc, nullptr, m_upload.put()));
    m_uploadSize[0] = width;
    m_uploadSize[1] = height;
    m_inputViews.clear();
  }
  D3D11_MAPPED_SUBRESOURCE mapped{};
  winrt::check_hresult(m_context->Map(m_staging.get(), 0, D3D11_MAP_WRITE, 0, &mapped));
  auto *dst = static_cast<uint8_t *>(mapped.pData);
  for (UINT y = 0; y < height; ++y) // luma plane, then the interleaved chroma plane right below it
    memcpy(dst + size_t(y) * mapped.RowPitch, frame->data[0] + size_t(y) * frame->linesize[0], width);
  dst += size_t(mapped.RowPitch) * height;
  for (UINT y = 0; y < height / 2; ++y)
    memcpy(dst + size_t(y) * mapped.RowPitch, frame->data[1] + size_t(y) * frame->linesize[1], width);
  m_context->Unmap(m_staging.get(), 0);
  m_context->CopyResource(m_upload.get(), m_staging.get());
  return m_upload.get();
}

void VideoOutput::SetColorSpaces(const AVFrame *frame) {
  const DXGI_COLOR_SPACE_TYPE input = InputColorSpace(frame);
  if (m_videoContext1) {
    m_videoContext1->VideoProcessorSetStreamColorSpace1(m_processor.get(), 0, input);
    m_videoContext1->VideoProcessorSetOutputColorSpace1(m_processor.get(), DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709);
    return;
  }
  D3D11_VIDEO_PROCESSOR_COLOR_SPACE in{};
  in.YCbCr_Matrix =
      (input == DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P601 || input == DXGI_COLOR_SPACE_YCBCR_FULL_G22_LEFT_P601) ? 0
                                                                                                                 : 1;
  in.Nominal_Range = frame->color_range == AVCOL_RANGE_JPEG ? D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_0_255
                                                            : D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
  D3D11_VIDEO_PROCESSOR_COLOR_SPACE out{};
  out.RGB_Range = 0; // full range RGB
  m_videoContext->VideoProcessorSetStreamColorSpace(m_processor.get(), 0, &in);
  m_videoContext->VideoProcessorSetOutputColorSpace(m_processor.get(), &out);
}

void VideoOutput::ClearRegion(ID3D11Texture2D *target, POINT offset) {
  winrt::com_ptr<ID3D11RenderTargetView> rtv;
  if (SUCCEEDED(m_device->CreateRenderTargetView(target, nullptr, rtv.put()))) {
    const float black[4] = {0, 0, 0, 1};
    const D3D11_RECT region{offset.x, offset.y, offset.x + LONG(m_width), offset.y + LONG(m_height)};
    m_context->ClearView(rtv.get(), black, &region, 1);
  }
}

// Converts and scales the frame into our m_width x m_height region of target, which starts at offset (the
// drawing surface may live in an atlas texture shared with other surfaces).
bool VideoOutput::Blt(const AVFrame *frame, ID3D11Texture2D *target, POINT offset) {
  ID3D11Texture2D *texture = nullptr;
  UINT slice = 0;
  if (frame->format == AV_PIX_FMT_D3D11) {
    texture = reinterpret_cast<ID3D11Texture2D *>(frame->data[0]);
    slice = UINT(reinterpret_cast<intptr_t>(frame->data[1]));
  } else if (frame->format == AV_PIX_FMT_NV12) {
    texture = Upload(frame);
  }
  if (!texture)
    return false;
  D3D11_TEXTURE2D_DESC desc{};
  texture->GetDesc(&desc);

  // Aspect-fit, honouring the sample aspect ratio.
  const double sar = frame->sample_aspect_ratio.num > 0 && frame->sample_aspect_ratio.den > 0
      ? av_q2d(frame->sample_aspect_ratio)
      : 1.0;
  const double videoAspect = frame->width * sar / std::max(frame->height, 1);
  double w = m_width, h = m_width / videoAspect;
  if (h > m_height) {
    h = m_height;
    w = m_height * videoAspect;
  }
  const LONG x = offset.x, y = offset.y;
  const RECT dest{x + LONG((m_width - w) / 2), y + LONG((m_height - h) / 2), x + LONG((m_width + w) / 2),
                  y + LONG((m_height + h) / 2)};

  if (HdrRenderer::IsHdr(frame)) {
    if (!m_hdr && !m_hdrFailed) {
      try {
        m_hdr = std::make_unique<HdrRenderer>(m_device.get());
      } catch (const winrt::hresult_error &) {
        m_hdrFailed = true; // no shader compiler: fall back to the video processor's (clipping) conversion
      }
    }
    if (m_hdr) {
      ClearRegion(target, offset);
      return m_hdr->Draw(frame, texture, slice, target, dest);
    }
  }

  if (!EnsureProcessor(desc.Width, desc.Height))
    return false;
  auto &inputView = m_inputViews[{texture, slice}];
  if (!inputView) {
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inDesc{};
    inDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
    inDesc.Texture2D.ArraySlice = slice;
    if (FAILED(m_videoDevice->CreateVideoProcessorInputView(texture, m_enumerator.get(), &inDesc, inputView.put())))
      return false;
  }
  winrt::com_ptr<ID3D11VideoProcessorOutputView> outputView;
  D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outDesc{};
  outDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
  if (FAILED(m_videoDevice->CreateVideoProcessorOutputView(target, m_enumerator.get(), &outDesc, outputView.put())))
    return false;

  const RECT source{0, 0, LONG(std::min<UINT>(frame->width, desc.Width)),
                    LONG(std::min<UINT>(frame->height, desc.Height))};
  const RECT region{x, y, x + LONG(m_width), y + LONG(m_height)};
  D3D11_VIDEO_COLOR black{};
  black.RGBA.A = 1;

  SetColorSpaces(frame);
  // The target rect bounds the blit (background included) to our region of the atlas.
  m_videoContext->VideoProcessorSetOutputTargetRect(m_processor.get(), TRUE, &region);
  m_videoContext->VideoProcessorSetOutputBackgroundColor(m_processor.get(), FALSE, &black);
  m_videoContext->VideoProcessorSetStreamSourceRect(m_processor.get(), 0, TRUE, &source);
  m_videoContext->VideoProcessorSetStreamDestRect(m_processor.get(), 0, TRUE, &dest);

  D3D11_VIDEO_PROCESSOR_STREAM stream{};
  stream.Enable = TRUE;
  stream.pInputSurface = inputView.get();
  return SUCCEEDED(m_videoContext->VideoProcessorBlt(m_processor.get(), outputView.get(), 0, 1, &stream));
}

void VideoOutput::Present(const AVFrame *frame) {
  std::lock_guard lock(m_lock);
  ApplyResize();
  winrt::com_ptr<ID3D11Texture2D> target;
  POINT offset{};
  winrt::check_hresult(m_surfaceInterop->BeginDraw(nullptr, IID_PPV_ARGS(target.put()), &offset));
  try {
    if (!frame || !Blt(frame, target.get(), offset))
      ClearRegion(target.get(), offset);
  } catch (...) {
    m_surfaceInterop->EndDraw();
    throw;
  }
  winrt::check_hresult(m_surfaceInterop->EndDraw());
}

} // namespace ReactNativeLibav
