#pragma once

#pragma warning(push, 0)
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/hwcontext.h>
#include <libavutil/imgutils.h>
#include <libavutil/pixdesc.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
}
#pragma warning(pop)

#include <memory>
#include <string>

namespace ReactNativeLibav {

// av_err2str is a C99 compound-literal macro, not usable from C++.
inline std::string AvError(int err) {
  char buf[AV_ERROR_MAX_STRING_SIZE]{};
  av_strerror(err, buf, sizeof(buf));
  return buf;
}

struct PacketDeleter {
  void operator()(AVPacket *p) const noexcept { av_packet_free(&p); }
};
using PacketPtr = std::unique_ptr<AVPacket, PacketDeleter>;

struct FrameDeleter {
  void operator()(AVFrame *f) const noexcept { av_frame_free(&f); }
};
using FramePtr = std::unique_ptr<AVFrame, FrameDeleter>;

struct CodecContextDeleter {
  void operator()(AVCodecContext *c) const noexcept { avcodec_free_context(&c); }
};
using CodecContextPtr = std::unique_ptr<AVCodecContext, CodecContextDeleter>;

} // namespace ReactNativeLibav
