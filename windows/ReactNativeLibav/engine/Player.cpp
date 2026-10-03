#include "pch.h"

#include "Player.h"

#include <algorithm>
#include <cmath>
#include <deque>

#include "CompositorClock.h"

namespace ReactNativeLibav {

namespace {

using namespace std::chrono_literals;

// The demuxer reads ahead until both queues hold this many packets (or the total is large).
constexpr size_t kMinQueuedPackets = 64;
constexpr size_t kMaxQueuedPackets = 4000;
// Surfaces the decoder may keep beyond its reference frames: the frame queue, the frame being shown, slack.
constexpr int kExtraHwFrames = 8;

// "file:///C:/a%20b.mp4" -> "C:/a b.mp4"; libavformat's file protocol only understands plain paths on Windows.
std::string NormalizeSource(std::string source) {
  if (source.rfind("file:///", 0) != 0)
    return source;
  std::string path;
  for (size_t i = 8; i < source.size(); ++i) {
    if (source[i] == '%' && i + 2 < source.size() && isxdigit(source[i + 1]) && isxdigit(source[i + 2])) {
      path += char(std::stoi(source.substr(i + 1, 2), nullptr, 16));
      i += 2;
    } else {
      path += source[i];
    }
  }
  return path;
}

double Seconds(int64_t ts, AVRational timeBase) {
  return ts == AV_NOPTS_VALUE ? 0 : ts * av_q2d(timeBase);
}

} // namespace

Player::Player(std::shared_ptr<VideoOutput> output, PlayerCallbacks callbacks)
    : m_output(std::move(output)), m_callbacks(std::move(callbacks)) {}

Player::~Player() {
  m_abort = true;
  m_videoPackets.Abort();
  m_audioPackets.Abort();
  m_frames.Abort();
  if (m_demuxThread.joinable())
    m_demuxThread.join();
  // The demux thread starts these, so they can be joined once it is gone.
  if (m_decodeThread.joinable())
    m_decodeThread.join();
  if (m_renderThread.joinable())
    m_renderThread.join();
  m_audio.reset();
  sws_freeContext(m_sws);
  m_videoCodec.reset();
  avformat_close_input(&m_format);
  m_output->ResetCaches();
}

void Player::Open(std::string source, bool hardwareDecoding) {
  m_hardwareDecoding = hardwareDecoding;
  m_demuxThread = std::thread([this, source = NormalizeSource(std::move(source))] { Demux(source); });
}

void Player::SetPaused(bool paused) {
  m_paused = paused;
  m_clock.SetPaused(paused);
  std::lock_guard lock(m_audioMutex);
  if (m_audio)
    m_audio->SetPaused(paused);
}

void Player::SetMuted(bool muted) {
  m_muted = muted;
  std::lock_guard lock(m_audioMutex);
  if (m_audio)
    m_audio->SetMuted(muted);
}

void Player::SetVolume(float volume) {
  m_volume = volume;
  std::lock_guard lock(m_audioMutex);
  if (m_audio)
    m_audio->SetVolume(volume);
}

void Player::Fail(const std::string &message) {
  if (!m_failed.exchange(true) && !m_abort && m_callbacks.onError)
    m_callbacks.onError(message);
}

int Player::Interrupt(void *opaque) noexcept {
  return static_cast<Player *>(opaque)->m_abort ? 1 : 0;
}

void Player::OpenInput(const std::string &source) {
  m_format = avformat_alloc_context();
  m_format->interrupt_callback = {&Player::Interrupt, this};
  int ret = avformat_open_input(&m_format, source.c_str(), nullptr, nullptr);
  if (ret < 0)
    throw std::runtime_error("Cannot open " + source + ": " + AvError(ret));
  if ((ret = avformat_find_stream_info(m_format, nullptr)) < 0)
    throw std::runtime_error("Cannot read stream info: " + AvError(ret));

  m_videoIndex = av_find_best_stream(m_format, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
  if (m_videoIndex < 0)
    throw std::runtime_error("No video stream in " + source);
  m_audioIndex = av_find_best_stream(m_format, AVMEDIA_TYPE_AUDIO, -1, m_videoIndex, nullptr, 0);
  for (unsigned i = 0; i < m_format->nb_streams; ++i)
    if (int(i) != m_videoIndex && int(i) != m_audioIndex)
      m_format->streams[i]->discard = AVDISCARD_ALL;

  m_videoTimeBase = m_format->streams[m_videoIndex]->time_base;
  m_startTime = m_format->start_time != AV_NOPTS_VALUE ? double(m_format->start_time) / AV_TIME_BASE : 0;
  m_duration = m_format->duration != AV_NOPTS_VALUE ? double(m_format->duration) / AV_TIME_BASE : 0;
  OpenVideoDecoder();

  if (m_audioIndex >= 0) {
    auto audio = std::make_unique<AudioOutput>(m_format->streams[m_audioIndex], m_audioPackets, m_clock,
                                               [this](const std::string &message) {
                                                 // Keep playing video on the system clock.
                                                 OutputDebugStringA((message + "\n").c_str());
                                               });
    audio->SetPaused(m_paused);
    audio->SetMuted(m_muted);
    audio->SetVolume(m_volume);
    if (audio->Start()) {
      std::lock_guard lock(m_audioMutex);
      m_audio = std::move(audio);
    } else {
      m_audioIndex = -1; // undecodable audio: play the video alone
    }
  }
}

void Player::OpenVideoDecoder() {
  AVStream *stream = m_format->streams[m_videoIndex];
  const AVCodec *decoder = avcodec_find_decoder(stream->codecpar->codec_id);
  if (!decoder)
    throw std::runtime_error(std::string("No decoder for ") + avcodec_get_name(stream->codecpar->codec_id));
  m_videoCodec.reset(avcodec_alloc_context3(decoder));
  avcodec_parameters_to_context(m_videoCodec.get(), stream->codecpar);
  m_videoCodec->pkt_timebase = stream->time_base;
  m_videoCodec->opaque = this;

  bool hw = false;
  if (m_hardwareDecoding) {
    for (int i = 0;; ++i) {
      const AVCodecHWConfig *config = avcodec_get_hw_config(decoder, i);
      if (!config)
        break;
      if (config->device_type == AV_HWDEVICE_TYPE_D3D11VA && (config->methods & AV_CODEC_HW_CONFIG_METHOD_HW_DEVICE_CTX)) {
        hw = true;
        break;
      }
    }
  }
  if (hw) {
    // Hand FFmpeg our device, so decoded surfaces can go straight into the video processor.
    AVBufferRef *deviceRef = av_hwdevice_ctx_alloc(AV_HWDEVICE_TYPE_D3D11VA);
    auto *d3d = static_cast<AVD3D11VADeviceContext *>(reinterpret_cast<AVHWDeviceContext *>(deviceRef->data)->hwctx);
    d3d->device = m_output->Device();
    d3d->device->AddRef(); // released by FFmpeg with the device context
    d3d->lock = &VideoOutput::LockCallback;
    d3d->unlock = &VideoOutput::UnlockCallback;
    d3d->lock_ctx = m_output.get();
    if (av_hwdevice_ctx_init(deviceRef) >= 0) {
      m_videoCodec->hw_device_ctx = av_buffer_ref(deviceRef);
      m_videoCodec->get_format = &Player::GetFormat;
      m_videoCodec->extra_hw_frames = kExtraHwFrames;
    } else {
      hw = false;
    }
    av_buffer_unref(&deviceRef);
  }
  if (!hw)
    m_videoCodec->thread_count = 0; // software: one thread per core

  const int ret = avcodec_open2(m_videoCodec.get(), decoder, nullptr);
  if (ret < 0)
    throw std::runtime_error(std::string("Cannot open the ") + decoder->name + " decoder: " + AvError(ret));
}

AVPixelFormat Player::GetFormat(AVCodecContext *ctx, const AVPixelFormat *formats) {
  auto *self = static_cast<Player *>(ctx->opaque);
  for (const AVPixelFormat *f = formats; *f != AV_PIX_FMT_NONE; ++f) {
    if (*f == AV_PIX_FMT_D3D11) {
      self->m_hwActive = true;
      return *f;
    }
  }
  // No D3D11VA for this stream (profile, size, ...): FFmpeg decodes in software.
  self->m_hwActive = false;
  for (const AVPixelFormat *f = formats; *f != AV_PIX_FMT_NONE; ++f) {
    const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(*f);
    if (desc && !(desc->flags & AV_PIX_FMT_FLAG_HWACCEL))
      return *f;
  }
  return AV_PIX_FMT_NONE;
}

void Player::Demux(std::string source) {
  SetThreadDescription(GetCurrentThread(), L"libav demux");
  try {
    OpenInput(source);
  } catch (const std::exception &e) {
    Fail(e.what());
    return;
  }
  m_decodeThread = std::thread([this] { DecodeVideo(); });
  m_renderThread = std::thread([this] { Render(); });

  // Timestamp shift added to packets after each loop, so the clock and the decoders see one continuous stream.
  int64_t offsetUs = 0;
  int64_t endUs = 0; // end of the latest packet, shifted
  PacketPtr packet{av_packet_alloc()};
  bool ended = false;
  while (!m_abort) {
    const size_t video = m_videoPackets.Size(), audio = m_audioPackets.Size();
    if (ended || video + audio > kMaxQueuedPackets ||
        (video >= kMinQueuedPackets && (m_audioIndex < 0 || audio >= kMinQueuedPackets))) {
      std::this_thread::sleep_for(5ms);
      continue;
    }
    const int ret = av_read_frame(m_format, packet.get());
    if (ret < 0) {
      if (m_abort)
        break;
      if (ret != AVERROR_EOF && m_format->pb && m_format->pb->error < 0)
        OutputDebugStringA(("libav: read error, treating as end of input: " + AvError(ret) + "\n").c_str());
      const bool loop = m_loop && av_seek_frame(m_format, -1, m_format->start_time != AV_NOPTS_VALUE ? m_format->start_time : 0,
                                                AVSEEK_FLAG_BACKWARD) >= 0;
      const auto marker = loop ? PacketItem::Kind::Flush : PacketItem::Kind::End;
      m_videoPackets.Push({marker, nullptr});
      if (m_audioIndex >= 0)
        m_audioPackets.Push({marker, nullptr});
      if (loop)
        offsetUs = endUs - int64_t(m_startTime * AV_TIME_BASE);
      else
        ended = true; // stays idle until closed
      continue;
    }
    const int index = packet->stream_index;
    if (index != m_videoIndex && index != m_audioIndex) {
      av_packet_unref(packet.get());
      continue;
    }
    const AVRational tb = m_format->streams[index]->time_base;
    const int64_t shift = av_rescale_q(offsetUs, AV_TIME_BASE_Q, tb);
    if (packet->pts != AV_NOPTS_VALUE)
      packet->pts += shift;
    if (packet->dts != AV_NOPTS_VALUE)
      packet->dts += shift;
    const int64_t last = packet->pts != AV_NOPTS_VALUE ? packet->pts : packet->dts;
    if (last != AV_NOPTS_VALUE)
      endUs = std::max(endUs, av_rescale_q(last + std::max<int64_t>(packet->duration, 0), tb, AV_TIME_BASE_Q));

    PacketPtr item{av_packet_alloc()};
    av_packet_move_ref(item.get(), packet.get());
    (index == m_videoIndex ? m_videoPackets : m_audioPackets).Push({PacketItem::Kind::Data, std::move(item)});
  }
}

FramePtr Player::ToNv12(FramePtr frame) {
  m_sws = sws_getCachedContext(m_sws, frame->width, frame->height, AVPixelFormat(frame->format), frame->width,
                               frame->height, AV_PIX_FMT_NV12, SWS_BILINEAR, nullptr, nullptr, nullptr);
  if (!m_sws)
    return nullptr;
  FramePtr out{av_frame_alloc()};
  out->format = AV_PIX_FMT_NV12;
  out->width = frame->width;
  out->height = frame->height;
  if (av_frame_get_buffer(out.get(), 0) < 0)
    return nullptr;
  sws_scale(m_sws, frame->data, frame->linesize, 0, frame->height, out->data, out->linesize);
  av_frame_copy_props(out.get(), frame.get());
  // swscale converts the yuvj (full range) formats to limited range NV12.
  const AVPixelFormat f = AVPixelFormat(frame->format);
  if (f == AV_PIX_FMT_YUVJ420P || f == AV_PIX_FMT_YUVJ422P || f == AV_PIX_FMT_YUVJ444P)
    out->color_range = AVCOL_RANGE_MPEG;
  return out;
}

bool Player::ReceiveVideoFrames() {
  for (;;) {
    FramePtr frame{av_frame_alloc()};
    const int ret = avcodec_receive_frame(m_videoCodec.get(), frame.get());
    if (ret == AVERROR(EAGAIN) || ret == AVERROR_EOF)
      return true;
    if (ret < 0) {
      OutputDebugStringA(("libav: video decode error: " + AvError(ret) + "\n").c_str());
      return true;
    }
    frame->pts = frame->best_effort_timestamp;
    if (frame->format != AV_PIX_FMT_D3D11 && frame->format != AV_PIX_FMT_NV12)
      frame = ToNv12(std::move(frame));
    if (!frame)
      continue;
    if (!m_loaded) {
      m_loaded = true;
      if (m_callbacks.onLoad) {
        AVStream *stream = m_format->streams[m_videoIndex];
        MediaInfo info;
        info.duration = m_duration;
        info.width = stream->codecpar->width;
        info.height = stream->codecpar->height;
        info.hasAudio = m_audioIndex >= 0;
        info.hwDecoding = frame->format == AV_PIX_FMT_D3D11;
        info.codec = avcodec_get_name(stream->codecpar->codec_id);
        m_callbacks.onLoad(info);
      }
    }
    if (!m_frames.Push(std::move(frame)))
      return false;
  }
}

void Player::DecodeVideo() {
  SetThreadDescription(GetCurrentThread(), L"libav video decode");
  while (!m_abort) {
    auto item = m_videoPackets.Pop(100ms);
    if (!item)
      continue;
    if (item->kind == PacketItem::Kind::Data) {
      int ret;
      while ((ret = avcodec_send_packet(m_videoCodec.get(), item->packet.get())) == AVERROR(EAGAIN))
        if (!ReceiveVideoFrames())
          return;
      if (ret < 0 && ret != AVERROR_EOF)
        OutputDebugStringA(("libav: video packet rejected: " + AvError(ret) + "\n").c_str());
      if (!ReceiveVideoFrames())
        return;
    } else {
      // Drain what the decoder still holds, then reset it for the next loop (or stop at the end).
      avcodec_send_packet(m_videoCodec.get(), nullptr);
      if (!ReceiveVideoFrames())
        return;
      avcodec_flush_buffers(m_videoCodec.get());
      if (item->kind == PacketItem::Kind::End)
        m_videoEnded = true;
    }
  }
}

void Player::Render() {
  SetThreadDescription(GetCurrentThread(), L"libav render");
  // Paced by the compositor: once per composited frame, pick the video frame that should be on screen when what
  // we draw now is displayed (the next compositor frame), and draw it if it is a new one. This shows each video
  // frame for whole refreshes, with no frame drawn and then overwritten before the compositor ever saw it.
  CompositorClock compositor(m_output->Device());
  std::deque<FramePtr> ready; // decoded, not shown yet (a few, taken from m_frames)
  FramePtr shown;             // on screen, kept for redraws (resize while paused, ...)
  bool endReported = false;
  double lastProgress = -1;
  const double period = m_duration;
  auto audioMaster = [&] { return m_audio && !m_audio->Failed(); };
  auto pts = [&](const FramePtr &frame) { return Seconds(frame->pts, m_videoTimeBase); };
  // Makes sure ready holds at least n frames, if decoded ones are available.
  auto fill = [&](size_t n) {
    while (ready.size() < n) {
      auto frame = m_frames.TryPop();
      if (!frame)
        return false;
      ready.push_back(std::move(*frame));
    }
    return true;
  };

  try {
    while (!m_abort) {
      compositor.Wait();
      const double refresh = compositor.RefreshPeriod();
      FramePtr next;

      if (!m_paused && fill(1)) {
        auto now = m_clock.Get();
        if (!now && !audioMaster()) { // no audio: the first frame starts the clock
          m_clock.Set(pts(ready.front()));
          now = m_clock.Get();
        }
        if (now) { // else: waiting for the audio to start
          const double displayTime = *now + refresh;
          if (pts(ready.front()) <= displayTime) {
            // Behind: skip frames whose successor is also due, by more than half a refresh (the slack keeps clock
            // jitter from dropping a frame, then repeating one, when the frame and refresh rates are close).
            while (fill(2) && pts(ready[1]) <= displayTime - refresh / 2)
              ready.pop_front();
            next = std::move(ready.front());
            ready.pop_front();
            const double late = displayTime - pts(next);
            if (!audioMaster() && late > 0.5) // stalled (slow source/decoder) without audio: catch the clock up
              m_clock.Set(pts(next) - refresh);
          }
        }
      }

      if (next) {
        m_output->Present(next.get());
        shown = std::move(next);
        const double t = pts(shown);
        if (m_callbacks.onProgress && std::abs(t - lastProgress) >= 0.25) {
          lastProgress = t;
          double current = std::max(0.0, t - m_startTime);
          if (period > 0)
            current = std::fmod(current, period);
          m_callbacks.onProgress(current, period);
        }
      } else if (m_output->ResizePending()) {
        m_output->Present(shown.get());
      }

      if (!endReported && m_videoEnded && ready.empty() && m_frames.Size() == 0 &&
          (!audioMaster() || m_audio->Finished())) {
        endReported = true;
        if (m_callbacks.onEnd)
          m_callbacks.onEnd();
      }
    }
  } catch (const winrt::hresult_error &e) {
    Fail("Rendering failed: " + winrt::to_string(e.message()));
  }
}

} // namespace ReactNativeLibav
