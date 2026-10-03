#include "AndroidVideoSink.h"

#include <android/looper.h>

#include <algorithm>
#include <cstring>
#include <ctime>
#include <string>

extern "C" {
#include <libavcodec/mediacodec.h>
#include <libavutil/hwcontext_mediacodec.h>
}

#include "Platform.h"

namespace ReactNativeLibav {

namespace {

int64_t MonotonicNs() {
  timespec ts{};
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return int64_t(ts.tv_sec) * 1'000'000'000 + ts.tv_nsec;
}

} // namespace

AndroidVideoSink::AndroidVideoSink(ANativeWindow *window) : m_window(window) {
  if (m_window)
    ANativeWindow_acquire(m_window);
}

AndroidVideoSink::~AndroidVideoSink() {
  if (m_window)
    ANativeWindow_release(m_window);
}

const AVCodec *AndroidVideoSink::HardwareDecoder(AVCodecID id) {
  if (!m_window)
    return nullptr;
  // FFmpeg's MediaCodec wrappers are decoders of their own, named after the codec.
  std::string name = id == AV_CODEC_ID_MPEG2VIDEO ? "mpeg2" : avcodec_get_name(id);
  name += "_mediacodec";
  return avcodec_find_decoder_by_name(name.c_str());
}

bool AndroidVideoSink::ConfigureHardwareDecoder(AVCodecContext *ctx, AVDictionary **options) {
  AVBufferRef *deviceRef = av_hwdevice_ctx_alloc(AV_HWDEVICE_TYPE_MEDIACODEC);
  if (!deviceRef)
    return false;
  auto *device =
      static_cast<AVMediaCodecDeviceContext *>(reinterpret_cast<AVHWDeviceContext *>(deviceRef->data)->hwctx);
  device->native_window = m_window; // decode straight into the SurfaceView
  const bool ok = av_hwdevice_ctx_init(deviceRef) >= 0;
  if (ok) {
    ctx->hw_device_ctx = av_buffer_ref(deviceRef);
    ctx->get_format = &AndroidVideoSink::GetFormat;
    av_dict_set(options, "ndk_codec", "1", 0); // the NDK AMediaCodec API: no JNI on the decoder thread
  }
  av_buffer_unref(&deviceRef);
  return ok;
}

AVPixelFormat AndroidVideoSink::GetFormat(AVCodecContext * /*ctx*/, const AVPixelFormat *formats) {
  for (const AVPixelFormat *f = formats; *f != AV_PIX_FMT_NONE; ++f)
    if (*f == AV_PIX_FMT_MEDIACODEC)
      return *f;
  return formats[0];
}

void AndroidVideoSink::OnVsync(long frameTimeNanos, void *data) {
  auto *self = static_cast<AndroidVideoSink *>(data);
  const int64_t vsync = int64_t(frameTimeNanos);
  if (self->m_lastVsyncNs > 0) {
    // Learn the refresh period from consecutive vsyncs (skipped ones are ignored).
    const double delta = double(vsync - self->m_lastVsyncNs) / 1e9;
    if (delta > 0.002 && delta < self->m_period * 1.5)
      self->m_period = self->m_period * 0.9 + delta * 0.1;
  }
  self->m_lastVsyncNs = vsync;
  self->m_vsyncArrived = true;
}

void AndroidVideoSink::WaitForFrame() {
  if (!m_choreographer) {
    // The render thread gets a looper for AChoreographer's callbacks.
    ALooper_prepare(0);
    m_choreographer = AChoreographer_getInstance();
  }
  m_vsyncArrived = false;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  // postFrameCallback64 needs API 29; on arm64 the long of this one is 64-bit as well.
  AChoreographer_postFrameCallback(m_choreographer, &AndroidVideoSink::OnVsync, this);
#pragma clang diagnostic pop
  const int64_t deadline = MonotonicNs() + 100'000'000; // the screen may be off: don't stall the loop
  while (!m_vsyncArrived) {
    const int64_t left = deadline - MonotonicNs();
    if (left <= 0)
      break;
    ALooper_pollOnce(int(left / 1'000'000) + 1, nullptr, nullptr, nullptr);
  }
  if (!m_vsyncArrived)
    m_lastVsyncNs = MonotonicNs();
}

void AndroidVideoSink::Present(const AVFrame *frame) {
  if (frame && frame->format == AV_PIX_FMT_MEDIACODEC) {
    m_hardwareOutput = true;
    auto *buffer = reinterpret_cast<AVMediaCodecBuffer *>(frame->data[3]);
    const int64_t displayAt = m_lastVsyncNs + int64_t(PresentLead() * m_period * 1e9);
    av_mediacodec_render_buffer_at_time(buffer, displayAt);
    return;
  }
  if (!m_hardwareOutput)
    PresentSoftware(frame);
}

void AndroidVideoSink::PresentSoftware(const AVFrame *frame) {
  if (!m_window)
    return;
  if (frame && (frame->width != m_bufferWidth || frame->height != m_bufferHeight)) {
    ANativeWindow_setBuffersGeometry(m_window, frame->width, frame->height, WINDOW_FORMAT_RGBA_8888);
    m_bufferWidth = frame->width;
    m_bufferHeight = frame->height;
  }
  if (!m_bufferWidth)
    return; // nothing shown yet: the view's background is black already
  ANativeWindow_Buffer buffer{};
  if (ANativeWindow_lock(m_window, &buffer, nullptr) != 0)
    return;
  auto *dst = static_cast<uint8_t *>(buffer.bits);
  const size_t dstPitch = size_t(buffer.stride) * 4;
  const int rows = std::min(buffer.height, frame ? frame->height : buffer.height);
  for (int y = 0; y < rows; ++y) {
    if (frame)
      memcpy(dst + y * dstPitch, frame->data[0] + size_t(y) * frame->linesize[0],
             size_t(std::min(buffer.width, frame->width)) * 4);
    else
      memset(dst + y * dstPitch, 0, size_t(buffer.width) * 4);
  }
  ANativeWindow_unlockAndPost(m_window);
}

} // namespace ReactNativeLibav
