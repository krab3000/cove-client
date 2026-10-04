#pragma once

#include <d3d11_1.h>

#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Composition.interop.h>

#include <atomic>
#include <functional>
#include <mutex>

#include <vlc/vlc.h>

namespace ReactNativeVlc {

// The video output libVLC draws into (libvlc_video_engine_d3d11 output callbacks). We own a D3D11 device and hand
// its immediate context to VLC, which decodes on it (D3D11VA) and renders each frame (YUV to RGB, scaling,
// letterboxing, HDR tone mapping) into our BGRA render texture. On swap the texture is copied into a
// CompositionDrawingSurface, which the component shows on its SpriteVisual. Frames never leave the GPU, and VLC
// paces presentation on its own clock.
// (VLC cannot draw into the drawing surface directly: BeginDraw hands out a region of an atlas at an offset.)
class VlcRenderer final {
 public:
  // On the UI thread. Throws winrt::hresult_error.
  explicit VlcRenderer(const winrt::Microsoft::UI::Composition::Compositor &compositor);
  ~VlcRenderer();

  const winrt::Microsoft::UI::Composition::CompositionDrawingSurface &Surface() const noexcept { return m_surface; }

  // Makes VLC render through this output. Call before playback starts; the renderer must outlive the player.
  void Attach(libvlc_media_player_t *player);
  // The view's size in pixels: VLC renders at that size. Thread-safe.
  void Resize(unsigned width, unsigned height);
  // Fills the surface with black (no video). Any thread.
  void Clear();
  // Called on VLC's thread once the next frame VLC presents is in the surface (one call per NotifyNextFrame).
  void SetFrameCallback(std::function<void()> callback) { m_onFrame = std::move(callback); }
  void NotifyNextFrame() noexcept { m_frameWanted = true; }

 private:
  static bool Setup(void **opaque, const libvlc_video_setup_device_cfg_t *cfg, libvlc_video_setup_device_info_t *out);
  static void Cleanup(void *opaque);
  static void SetWindow(void *opaque, libvlc_video_output_resize_cb reportSizeChange,
                        libvlc_video_output_mouse_move_cb, libvlc_video_output_mouse_press_cb,
                        libvlc_video_output_mouse_release_cb, void *reportOpaque);
  static bool UpdateOutput(void *opaque, const libvlc_video_render_cfg_t *cfg, libvlc_video_output_cfg_t *out);
  static void Swap(void *opaque);
  static bool MakeCurrent(void *opaque, bool enter);
  static bool SelectPlane(void *opaque, size_t plane, void *output);

  void Present(bool clear);

  winrt::com_ptr<ID3D11Device> m_device;
  winrt::com_ptr<ID3D11DeviceContext> m_context;
  // Guards the immediate context between VLC (it takes it around its own use) and us.
  HANDLE m_contextMutex = nullptr;

  winrt::Microsoft::UI::Composition::CompositionGraphicsDevice m_graphicsDevice{nullptr};
  winrt::Microsoft::UI::Composition::CompositionDrawingSurface m_surface{nullptr};
  winrt::com_ptr<winrt::Microsoft::UI::Composition::ICompositionDrawingSurfaceInterop> m_surfaceInterop;
  UINT m_surfaceSize[2]{16, 16};

  // VLC's render target, at the size VLC last asked for (update_output). Only VLC's thread touches it.
  winrt::com_ptr<ID3D11Texture2D> m_texture;
  winrt::com_ptr<ID3D11RenderTargetView> m_rtv;
  UINT m_textureSize[2]{};

  std::function<void()> m_onFrame;
  std::atomic<bool> m_frameWanted{false};

  std::mutex m_sizeLock;
  unsigned m_viewSize[2]{};
  libvlc_video_output_resize_cb m_reportSizeChange = nullptr;
  void *m_reportOpaque = nullptr;
};

} // namespace ReactNativeVlc
