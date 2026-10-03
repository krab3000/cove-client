#pragma once

#include <d3d11_1.h>
#include <dxgi1_3.h>

#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Composition.interop.h>

#include <atomic>
#include <map>
#include <mutex>

#include "FFmpeg.h"

namespace ReactNativeLibav {

// GPU side of the player. One D3D11 device is shared with FFmpeg's D3D11VA decoder and is also the rendering
// device of a CompositionGraphicsDevice. The component shows that device's CompositionDrawingSurface on its
// SpriteVisual. For each frame, BeginDraw hands back the surface's own D3D11 texture and a D3D11 video processor
// converts the decoded NV12/P010 surface to BGRA in it, scaled and letterboxed. Frames never leave the GPU.
// (Microsoft.UI.Composition has no public swapchain interop, so the drawing surface replaces a swapchain here.)
// Software-decoded frames, converted to NV12 by the decoder, are uploaded once and then take the same path.
class VideoOutput {
 public:
  // On the UI thread. Throws winrt::hresult_error.
  explicit VideoOutput(const winrt::Microsoft::UI::Composition::Compositor &compositor);
  ~VideoOutput();

  ID3D11Device *Device() const noexcept { return m_device.get(); }
  const winrt::Microsoft::UI::Composition::CompositionDrawingSurface &Surface() const noexcept { return m_surface; }

  // Serializes use of the immediate context between the decoder (through AVD3D11VADeviceContext.lock) and us.
  static void LockCallback(void *ctx) noexcept { static_cast<VideoOutput *>(ctx)->m_lock.lock(); }
  static void UnlockCallback(void *ctx) noexcept { static_cast<VideoOutput *>(ctx)->m_lock.unlock(); }

  // Thread-safe. The surface is resized on the next Present.
  void Resize(uint32_t width, uint32_t height) noexcept;
  bool ResizePending() const noexcept { return m_pendingSize.load() != 0; }

  // Draws a frame (AV_PIX_FMT_D3D11 or AV_PIX_FMT_NV12), aspect-fit on black. nullptr draws black. Any thread.
  void Present(const AVFrame *frame);

  // Drops cached views of decoder surfaces; call when the decoder that owns them goes away.
  void ResetCaches();

 private:
  void ApplyResize();
  bool EnsureProcessor(UINT inWidth, UINT inHeight);
  ID3D11Texture2D *Upload(const AVFrame *frame);
  void SetColorSpaces(const AVFrame *frame);
  bool Blt(const AVFrame *frame, ID3D11Texture2D *target, POINT offset);

  std::recursive_mutex m_lock;
  winrt::com_ptr<ID3D11Device> m_device;
  winrt::com_ptr<ID3D11DeviceContext1> m_context;
  winrt::com_ptr<ID3D11VideoDevice> m_videoDevice;
  winrt::com_ptr<ID3D11VideoContext> m_videoContext;
  winrt::com_ptr<ID3D11VideoContext1> m_videoContext1;

  winrt::Microsoft::UI::Composition::CompositionGraphicsDevice m_graphicsDevice{nullptr};
  winrt::Microsoft::UI::Composition::CompositionDrawingSurface m_surface{nullptr};
  winrt::com_ptr<winrt::Microsoft::UI::Composition::ICompositionDrawingSurfaceInterop> m_surfaceInterop;

  std::atomic<uint64_t> m_pendingSize{0};
  UINT m_width = 16;
  UINT m_height = 16;

  winrt::com_ptr<ID3D11VideoProcessorEnumerator> m_enumerator;
  winrt::com_ptr<ID3D11VideoProcessor> m_processor;
  UINT m_processorIn[2]{};
  UINT m_processorOut[2]{};
  std::map<std::pair<ID3D11Texture2D *, UINT>, winrt::com_ptr<ID3D11VideoProcessorInputView>> m_inputViews;

  winrt::com_ptr<ID3D11Texture2D> m_staging;
  winrt::com_ptr<ID3D11Texture2D> m_upload;
  UINT m_uploadSize[2]{};
};

} // namespace ReactNativeLibav
