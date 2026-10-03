#pragma once

#include <android/choreographer.h>
#include <android/native_window.h>

#include <cstdint>

#include "VideoSink.h"

namespace ReactNativeLibav {

// Android video output into the Surface of the component's SurfaceView (as an ANativeWindow):
// - Hardware: FFmpeg's MediaCodec decoders (h264_mediacodec, hevc_mediacodec, ...) decode straight into the window.
//   Present releases the output buffer for display at a given vsync (av_mediacodec_render_buffer_at_time), so
//   SurfaceFlinger shows it exactly then. HDR goes to the surface with its dataspace and is handled by the system.
// - Software: frames converted to RGBA by the player are copied into the window's buffer.
// Pacing: the render thread waits for vsync with AChoreographer on its own looper. The SurfaceView scales the
// buffer; letterboxing is done by the Kotlin view sizing it.
class AndroidVideoSink final : public VideoSink {
 public:
  explicit AndroidVideoSink(ANativeWindow *window); // acquires a reference
  ~AndroidVideoSink() override;

  const AVCodec *HardwareDecoder(AVCodecID id) override;
  bool ConfigureHardwareDecoder(AVCodecContext *ctx, AVDictionary **options) override;
  AVPixelFormat SoftwareFormat() const override { return AV_PIX_FMT_RGBA; }
  // MediaCodec has only a few output buffers: hold few decoded frames.
  size_t FrameQueueDepth() const override { return 2; }
  void WaitForFrame() override;
  double RefreshPeriod() const override { return m_period; }
  // Frames are released for the vsync after next, the margin MediaCodec recommends.
  int PresentLead() const override { return 2; }
  void Present(const AVFrame *frame) override;
  bool ResizePending() const override { return false; }

 private:
  static void OnVsync(long frameTimeNanos, void *data);
  static AVPixelFormat GetFormat(AVCodecContext *ctx, const AVPixelFormat *formats);
  void PresentSoftware(const AVFrame *frame);

  ANativeWindow *m_window;
  bool m_hardwareOutput = false; // the window belongs to MediaCodec: CPU access is not possible
  int m_bufferWidth = 0;
  int m_bufferHeight = 0;

  // Render thread.
  AChoreographer *m_choreographer = nullptr;
  bool m_vsyncArrived = false;
  int64_t m_lastVsyncNs = 0; // CLOCK_MONOTONIC, the clock MediaCodec render times use
  double m_period = 1.0 / 60;
};

} // namespace ReactNativeLibav
