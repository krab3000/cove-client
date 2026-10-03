#pragma once

#include "FFmpeg.h"

namespace ReactNativeLibav {

// Where decoded video goes, implemented per platform (Windows: D3D11 + composition, Android: MediaCodec surface /
// ANativeWindow). The Player's render thread is paced by it: once per display refresh it waits in WaitForFrame, picks
// the frame due when what it draws is displayed (the next refresh), and presents it.
class VideoSink {
 public:
  virtual ~VideoSink() = default;

  // The hardware decoder for a stream, or nullptr to decode it in software. It may be the regular decoder with a
  // hardware accelerator attached by ConfigureHardwareDecoder (D3D11VA) or a separate one (h264_mediacodec).
  virtual const AVCodec *HardwareDecoder(AVCodecID id) = 0;
  // Called before avcodec_open2 on a context for HardwareDecoder's codec: attaches the hardware device, get_format,
  // decoder options. False if hardware decoding cannot be set up (the player then decodes in software).
  virtual bool ConfigureHardwareDecoder(AVCodecContext *ctx, AVDictionary **options) = 0;
  // The pixel format software-decoded frames must have; the player converts to it when needed.
  virtual AVPixelFormat SoftwareFormat() const = 0;
  // Decoded frames the player may hold at most (hardware decoders have a limited number of output surfaces).
  virtual size_t FrameQueueDepth() const { return 4; }

  // Blocks until the next display refresh.
  virtual void WaitForFrame() = 0;
  // Seconds between display refreshes.
  virtual double RefreshPeriod() const = 0;
  // Shows frame (nullptr: black) from the next refresh on. Frames are hardware frames from the configured decoder or
  // software frames in SoftwareFormat(). Throws std::runtime_error when the output fails.
  virtual void Present(const AVFrame *frame) = 0;
  // The output changed size and wants the current frame drawn again.
  virtual bool ResizePending() const = 0;
  // The decoder that owns cached surfaces went away.
  virtual void ResetCaches() {}
};

} // namespace ReactNativeLibav
