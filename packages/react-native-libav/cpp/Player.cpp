#include "Player.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <deque>
#include <stdexcept>
#include <utility>

#include "Platform.h"

namespace ReactNativeLibav {

namespace {

using namespace std::chrono_literals;

// The demuxer reads ahead until both queues hold this many packets (or the total is large).
constexpr size_t kMinQueuedPackets = 64;
constexpr size_t kMaxQueuedPackets = 4000;

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

std::string Metadata(const AVDictionary *dict, const char *key) {
  const AVDictionaryEntry *entry = av_dict_get(dict, key, nullptr, 0);
  return entry ? entry->value : "";
}

bool IsHardwareFrame(const AVFrame *frame) {
  const AVPixFmtDescriptor *desc = av_pix_fmt_desc_get(AVPixelFormat(frame->format));
  return desc && (desc->flags & AV_PIX_FMT_FLAG_HWACCEL);
}

} // namespace

Player::Player(std::shared_ptr<VideoSink> sink, PlayerCallbacks callbacks)
    : m_sink(std::move(sink)), m_callbacks(std::move(callbacks)), m_frames(m_sink->FrameQueueDepth()) {}

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
  m_sink->ResetCaches();
}

void Player::Open(std::string source, bool hardwareDecoding, int audioTrack) {
  m_hardwareDecoding = hardwareDecoding;
  {
    std::lock_guard lock(m_requestMutex); // Demux takes the initial track from here
    m_trackRequest = audioTrack;
  }
  m_demuxThread = std::thread([this, source = NormalizeSource(std::move(source))] { Demux(source); });
}

std::shared_ptr<AudioOutput> Player::Audio() {
  std::lock_guard lock(m_audioMutex);
  return m_audio;
}

void Player::SetPaused(bool paused) {
  m_paused = paused;
  m_clock.SetPaused(paused);
  if (auto audio = Audio())
    audio->SetPaused(paused);
}

void Player::SetMuted(bool muted) {
  m_muted = muted;
  if (auto audio = Audio())
    audio->SetMuted(muted);
}

void Player::SetVolume(float volume) {
  m_volume = volume;
  if (auto audio = Audio())
    audio->SetVolume(volume);
}

void Player::Seek(double seconds) {
  std::lock_guard lock(m_requestMutex);
  m_seekRequest = seconds;
}

void Player::SetAudioTrack(int index) {
  std::lock_guard lock(m_requestMutex);
  m_trackRequest = index;
}

void Player::Fail(const std::string &message) {
  if (!m_failed.exchange(true) && !m_abort && m_callbacks.onError)
    m_callbacks.onError(message);
}

int Player::Interrupt(void *opaque) noexcept {
  return static_cast<Player *>(opaque)->m_abort ? 1 : 0;
}

// index if it is an audio stream, else the default audio stream (-1 if there is none).
int Player::ValidAudioTrack(int index) const {
  if (index >= 0 && unsigned(index) < m_format->nb_streams &&
      m_format->streams[index]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO)
    return index;
  return av_find_best_stream(m_format, AVMEDIA_TYPE_AUDIO, -1, m_videoIndex, nullptr, 0);
}

void Player::OpenInput(const std::string &source, int audioTrack) {
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
  for (unsigned i = 0; i < m_format->nb_streams; ++i) {
    AVStream *stream = m_format->streams[i];
    if (int(i) != m_videoIndex)
      stream->discard = AVDISCARD_ALL; // the audio track in use is enabled by StartAudio
    if (stream->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
      AudioTrackInfo track;
      track.index = int(i);
      track.language = Metadata(stream->metadata, "language");
      track.title = Metadata(stream->metadata, "title");
      if (track.title.empty())
        track.title = Metadata(stream->metadata, "handler_name");
      track.codec = avcodec_get_name(stream->codecpar->codec_id);
      track.channels = stream->codecpar->ch_layout.nb_channels;
      track.sampleRate = stream->codecpar->sample_rate;
      m_info.audioTracks.push_back(std::move(track));
    }
  }

  m_videoTimeBase = m_format->streams[m_videoIndex]->time_base;
  m_startTime = m_format->start_time != AV_NOPTS_VALUE ? double(m_format->start_time) / AV_TIME_BASE : 0;
  m_duration = m_format->duration != AV_NOPTS_VALUE ? double(m_format->duration) / AV_TIME_BASE : 0;
  OpenVideoDecoder();

  if (const int index = ValidAudioTrack(audioTrack); index >= 0 && !StartAudio(index))
    m_audioIndex = -1; // undecodable audio: play the video alone
}

// Starts playing audio stream index (none is playing). False if it cannot be decoded.
bool Player::StartAudio(int index) {
  auto audio = std::make_shared<AudioOutput>(m_format->streams[index], m_audioPackets, m_clock, m_seek);
  audio->SetPaused(m_paused);
  audio->SetMuted(m_muted);
  audio->SetVolume(m_volume);
  if (!audio->Start())
    return false;
  m_format->streams[index]->discard = AVDISCARD_DEFAULT;
  m_audioIndex = index;
  std::lock_guard lock(m_audioMutex);
  m_audio = std::move(audio);
  return true;
}

void Player::OpenVideoDecoder() {
  const AVCodecID id = m_format->streams[m_videoIndex]->codecpar->codec_id;
  if (m_hardwareDecoding) {
    if (const AVCodec *hardware = m_sink->HardwareDecoder(id); hardware && OpenDecoder(hardware, true))
      return;
  }
  // No hardware decoder for this stream (codec, profile, size, ...), or not wanted: decode in software.
  const AVCodec *decoder = avcodec_find_decoder(id);
  if (!decoder)
    throw std::runtime_error(std::string("No decoder for ") + avcodec_get_name(id));
  if (!OpenDecoder(decoder, false))
    throw std::runtime_error(std::string("Cannot open the ") + decoder->name + " decoder");
}

bool Player::OpenDecoder(const AVCodec *codec, bool hardware) {
  CodecContextPtr ctx{avcodec_alloc_context3(codec)};
  avcodec_parameters_to_context(ctx.get(), m_format->streams[m_videoIndex]->codecpar);
  ctx->pkt_timebase = m_format->streams[m_videoIndex]->time_base;
  AVDictionary *options = nullptr;
  if (hardware) {
    if (!m_sink->ConfigureHardwareDecoder(ctx.get(), &options)) {
      av_dict_free(&options);
      return false;
    }
  } else {
    ctx->thread_count = 0; // one thread per core
  }
  const int ret = avcodec_open2(ctx.get(), codec, &options);
  av_dict_free(&options);
  if (ret < 0) {
    Log(std::string("cannot open the ") + codec->name + " decoder: " + AvError(ret));
    return false;
  }
  m_videoCodec = std::move(ctx);
  return true;
}

bool Player::HandleRequests() {
  std::optional<double> seek;
  std::optional<int> track;
  {
    std::lock_guard lock(m_requestMutex);
    seek = std::exchange(m_seekRequest, std::nullopt);
    track = std::exchange(m_trackRequest, std::nullopt);
  }

  if (track) {
    const int index = ValidAudioTrack(*track);
    if (index != m_audioIndex) {
      // Switch: stop the current output, start one on the new stream, and resume from where we are.
      std::shared_ptr<AudioOutput> old;
      {
        std::lock_guard lock(m_audioMutex);
        old = std::move(m_audio);
      }
      if (old)
        old->Stop(); // now, even if the renderer still holds a reference for a moment
      old.reset();
      if (m_audioIndex >= 0)
        m_format->streams[m_audioIndex]->discard = AVDISCARD_ALL;
      m_audioIndex = -1;
      if (index >= 0 && !StartAudio(index))
        Fail("Cannot decode audio track " + std::to_string(index));
      m_info.audioTrack = m_audioIndex;
      if (!seek)
        seek = m_position.load();
    }
  }
  if (!seek)
    return false;

  const double seconds = std::clamp(*seek, 0.0, m_duration > 0 ? m_duration : 1e12);
  const double target = m_startTime + seconds; // in stream time: the loop shift starts over from 0
  m_seek.target = target;
  const int serial = m_seek.serial + 1;
  m_clock.Reset(serial);
  m_seek.serial = serial;
  m_videoPackets.Clear();
  m_audioPackets.Clear();
  m_frames.Clear();

  const int64_t ts = int64_t(target * AV_TIME_BASE);
  // Lands on the keyframe at or before the target; the decoders drop the frames up to it.
  if (avformat_seek_file(m_format, -1, INT64_MIN, ts, ts, 0) < 0)
    av_seek_frame(m_format, -1, ts, AVSEEK_FLAG_BACKWARD);
  m_offsetUs = 0;
  m_endUs = 0;
  m_ended = false;
  m_videoEnded = false;
  m_position = seconds;
  return true;
}

void Player::Demux(std::string source) {
  SetThreadName("libav demux");
  int audioTrack = -1;
  {
    std::lock_guard lock(m_requestMutex);
    audioTrack = std::exchange(m_trackRequest, std::nullopt).value_or(-1);
  }
  try {
    OpenInput(source, audioTrack);
  } catch (const std::exception &e) {
    Fail(e.what());
    return;
  }
  m_info.audioTrack = m_audioIndex;
  m_decodeThread = std::thread([this] { DecodeVideo(); });
  m_renderThread = std::thread([this] { Render(); });

  PacketPtr packet{av_packet_alloc()};
  while (!m_abort) {
    HandleRequests();
    const size_t video = m_videoPackets.Size(), audio = m_audioPackets.Size();
    if (m_ended || video + audio > kMaxQueuedPackets ||
        (video >= kMinQueuedPackets && (m_audioIndex < 0 || audio >= kMinQueuedPackets))) {
      std::this_thread::sleep_for(5ms);
      continue;
    }
    const int serial = m_seek.serial;
    const int ret = av_read_frame(m_format, packet.get());
    if (ret < 0) {
      if (m_abort)
        break;
      if (ret != AVERROR_EOF && m_format->pb && m_format->pb->error < 0)
        Log("read error, treating as end of input: " + AvError(ret));
      const bool loop = m_loop && av_seek_frame(m_format, -1, m_format->start_time != AV_NOPTS_VALUE ? m_format->start_time : 0,
                                                AVSEEK_FLAG_BACKWARD) >= 0;
      const auto marker = loop ? PacketItem::Kind::Flush : PacketItem::Kind::End;
      m_videoPackets.Push({marker, nullptr, serial});
      if (m_audioIndex >= 0)
        m_audioPackets.Push({marker, nullptr, serial});
      if (loop)
        // Timestamps after the loop are shifted past the end, so the clock and decoders see one continuous stream.
        m_offsetUs = m_endUs - int64_t(m_startTime * AV_TIME_BASE);
      else
        m_ended = true; // idle until a seek, or closed
      continue;
    }
    const int index = packet->stream_index;
    if (index != m_videoIndex && index != m_audioIndex) {
      av_packet_unref(packet.get());
      continue;
    }
    const AVRational tb = m_format->streams[index]->time_base;
    const int64_t shift = av_rescale_q(m_offsetUs, AV_TIME_BASE_Q, tb);
    if (packet->pts != AV_NOPTS_VALUE)
      packet->pts += shift;
    if (packet->dts != AV_NOPTS_VALUE)
      packet->dts += shift;
    const int64_t last = packet->pts != AV_NOPTS_VALUE ? packet->pts : packet->dts;
    if (last != AV_NOPTS_VALUE)
      m_endUs = std::max(m_endUs, av_rescale_q(last + std::max<int64_t>(packet->duration, 0), tb, AV_TIME_BASE_Q));

    PacketPtr item{av_packet_alloc()};
    av_packet_move_ref(item.get(), packet.get());
    (index == m_videoIndex ? m_videoPackets : m_audioPackets).Push({PacketItem::Kind::Data, std::move(item), serial});
  }
}

FramePtr Player::ToSoftwareFormat(FramePtr frame) {
  const AVPixelFormat format = m_sink->SoftwareFormat();
  m_sws = sws_getCachedContext(m_sws, frame->width, frame->height, AVPixelFormat(frame->format), frame->width,
                               frame->height, format, SWS_BILINEAR, nullptr, nullptr, nullptr);
  if (!m_sws)
    return nullptr;
  FramePtr out{av_frame_alloc()};
  out->format = format;
  out->width = frame->width;
  out->height = frame->height;
  if (av_frame_get_buffer(out.get(), 0) < 0)
    return nullptr;
  sws_scale(m_sws, frame->data, frame->linesize, 0, frame->height, out->data, out->linesize);
  av_frame_copy_props(out.get(), frame.get());
  // swscale converts the yuvj (full range) formats to limited range YUV.
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
      Log("video decode error: " + AvError(ret));
      return true;
    }
    frame->pts = frame->best_effort_timestamp;
    if (m_decodeTarget >= 0) {
      // After a seek: decoding starts at a keyframe before the target; skip to the frame showing at the target.
      const double pts = Seconds(frame->pts, m_videoTimeBase);
      const double duration = frame->duration > 0 ? Seconds(frame->duration, m_videoTimeBase) : 0.001;
      if (pts + duration <= m_decodeTarget)
        continue;
      m_decodeTarget = -1;
    }
    if (!IsHardwareFrame(frame.get()) && frame->format != m_sink->SoftwareFormat())
      frame = ToSoftwareFormat(std::move(frame));
    if (!frame)
      continue;
    SetFrameSerial(frame.get(), m_decodeSerial);
    if (!m_loaded) {
      m_loaded = true;
      if (m_callbacks.onLoad) {
        AVStream *stream = m_format->streams[m_videoIndex];
        MediaInfo info = m_info;
        info.duration = m_duration;
        info.width = stream->codecpar->width;
        info.height = stream->codecpar->height;
        const AVRational sar = av_guess_sample_aspect_ratio(m_format, stream, frame.get());
        info.aspect = info.height > 0
            ? info.width * (sar.num > 0 && sar.den > 0 ? av_q2d(sar) : 1.0) / info.height
            : 0;
        info.hasAudio = m_info.audioTrack >= 0;
        info.hwDecoding = IsHardwareFrame(frame.get());
        info.codec = avcodec_get_name(stream->codecpar->codec_id);
        m_callbacks.onLoad(info);
      }
    }
    if (!m_frames.Push(std::move(frame)))
      return false;
  }
}

void Player::DecodeVideo() {
  SetThreadName("libav decode");
  m_decodeSerial = m_seek.serial;
  while (!m_abort) {
    auto item = m_videoPackets.Pop(100ms);
    if (!item)
      continue;
    if (item->serial != m_decodeSerial) {
      if (item->serial < m_decodeSerial)
        continue; // stale, from before a seek
      // First packet after a seek: forget the old position.
      avcodec_flush_buffers(m_videoCodec.get());
      m_decodeSerial = item->serial;
      m_decodeTarget = m_seek.target;
    }
    if (item->kind == PacketItem::Kind::Data) {
      int ret;
      while ((ret = avcodec_send_packet(m_videoCodec.get(), item->packet.get())) == AVERROR(EAGAIN))
        if (!ReceiveVideoFrames())
          return;
      if (ret < 0 && ret != AVERROR_EOF)
        Log("video packet rejected: " + AvError(ret));
      if (!ReceiveVideoFrames())
        return;
    } else {
      // Drain what the decoder still holds, then reset it for the next loop (or stop at the end).
      avcodec_send_packet(m_videoCodec.get(), nullptr);
      if (!ReceiveVideoFrames())
        return;
      avcodec_flush_buffers(m_videoCodec.get());
      if (item->kind == PacketItem::Kind::End && item->serial == m_seek.serial)
        m_videoEnded = true;
    }
  }
}

void Player::Render() {
  SetThreadName("libav render");
  // Paced by the display: once per refresh, pick the video frame that should be on screen when what we draw now is
  // displayed (the next refresh), and present it if it is a new one. This shows each video frame for whole
  // refreshes, with no frame drawn and then overwritten before the display ever showed it.
  std::deque<FramePtr> ready; // decoded, not shown yet (a few, taken from m_frames)
  FramePtr shown;             // on screen, kept for redraws (resize while paused, ...)
  int serial = m_seek.serial;
  bool seekPending = false; // report (and, while paused, show) the first frame after a seek
  bool endReported = false;
  double lastProgress = -1;
  const double period = m_duration;
  auto pts = [&](const FramePtr &frame) { return Seconds(frame->pts, m_videoTimeBase); };
  // Makes sure ready holds at least n frames of the current serial, if decoded ones are available.
  auto fill = [&](size_t n) {
    while (ready.size() < n) {
      auto frame = m_frames.TryPop();
      if (!frame)
        return false;
      if (FrameSerial(frame->get()) == serial)
        ready.push_back(std::move(*frame));
    }
    return true;
  };
  // Seconds from the start, as reported to JS (within the file when looping).
  auto position = [&](double framePts) {
    double t = std::max(0.0, framePts - m_startTime);
    return period > 0 ? std::fmod(t, period) : t;
  };

  try {
    while (!m_abort) {
      m_sink->WaitForFrame();
      const double refresh = m_sink->RefreshPeriod();
      const double lead = refresh * m_sink->PresentLead(); // until what we present now is on screen
      const auto audio = Audio();
      const bool audioMaster = audio && !audio->Failed();

      if (const int current = m_seek.serial; current != serial) {
        serial = current;
        ready.clear();
        seekPending = true;
        endReported = false;
        lastProgress = -1;
      }

      FramePtr next;
      if (!m_paused && fill(1)) {
        auto now = m_clock.Get();
        if (!now && !audioMaster) { // no audio: the first frame starts the clock
          m_clock.Set(pts(ready.front()), serial);
          now = m_clock.Get();
        }
        if (now) { // else: waiting for the audio to start
          const double displayTime = *now + lead;
          if (pts(ready.front()) <= displayTime) {
            // Behind: skip frames whose successor is also due, by more than half a refresh (the slack keeps clock
            // jitter from dropping a frame, then repeating one, when the frame and refresh rates are close).
            while (fill(2) && pts(ready[1]) <= displayTime - refresh / 2)
              ready.pop_front();
            next = std::move(ready.front());
            ready.pop_front();
            if (!audioMaster && displayTime - pts(next) > 0.5) // stalled without audio: catch the clock up
              m_clock.Set(pts(next) - lead, serial);
          }
        }
      } else if (m_paused && seekPending && fill(1)) {
        // Seeked while paused: show the new position (the clock starts again on resume).
        next = std::move(ready.front());
        ready.pop_front();
      }

      if (next) {
        m_sink->Present(next.get());
        shown = std::move(next);
        const double t = position(pts(shown));
        m_position = t;
        if (seekPending) {
          seekPending = false;
          if (m_callbacks.onSeek)
            m_callbacks.onSeek(t);
        }
        if (m_callbacks.onProgress && (lastProgress < 0 || std::abs(t - lastProgress) >= 0.25)) {
          lastProgress = t;
          m_callbacks.onProgress(t, period);
        }
      } else if (m_sink->ResizePending()) {
        m_sink->Present(shown.get());
      }

      if (!endReported && m_videoEnded && ready.empty() && m_frames.Size() == 0 &&
          (!audioMaster || audio->Finished())) {
        endReported = true;
        if (m_callbacks.onEnd)
          m_callbacks.onEnd();
      }
    }
  } catch (const std::exception &e) {
    Fail(std::string("Rendering failed: ") + e.what());
  }
}

} // namespace ReactNativeLibav
