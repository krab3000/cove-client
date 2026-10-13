#include "MpvPlayer.h"

#include "HttpCache.h"
#include "Platform.h"
#include "Trace.h"

#if defined(LIBAV_MPV)

#include <dlfcn.h>
#include <mpv/client.h>
#include <mpv/stream_cb.h>

#include <algorithm>
#include <climits>
#include <cstdio>

extern "C" {
#include <libavformat/avio.h> // AVSEEK_SIZE
}

namespace ReactNativeLibav {

namespace {

// libmpv's C API, from the libmpv.so debug builds ship (dlopen: release builds have none, and the engine is then
// unavailable). The pointers have the headers' types (scripts/mpv-android puts them in third_party/mpv).
struct MpvApi {
  decltype(&mpv_create) create = nullptr;
  decltype(&mpv_initialize) initialize = nullptr;
  decltype(&mpv_terminate_destroy) terminate_destroy = nullptr;
  decltype(&mpv_set_option) set_option = nullptr;
  decltype(&mpv_set_option_string) set_option_string = nullptr;
  decltype(&mpv_set_property_string) set_property_string = nullptr;
  decltype(&mpv_get_property) get_property = nullptr;
  decltype(&mpv_get_property_string) get_property_string = nullptr;
  decltype(&mpv_command_async) command_async = nullptr;
  decltype(&mpv_observe_property) observe_property = nullptr;
  decltype(&mpv_wait_event) wait_event = nullptr;
  decltype(&mpv_wakeup) wakeup = nullptr;
  decltype(&mpv_request_log_messages) request_log_messages = nullptr;
  decltype(&mpv_stream_cb_add_ro) stream_cb_add_ro = nullptr;
  decltype(&mpv_free) free = nullptr;
  decltype(&mpv_free_node_contents) free_node_contents = nullptr;
  decltype(&mpv_error_string) error_string = nullptr;
  bool ok = false;
};

const MpvApi &Api() {
  static const MpvApi api = [] {
    MpvApi a;
    void *lib = dlopen("libmpv.so", RTLD_NOW);
    if (!lib) {
      LogTo("mpv", std::string("libmpv.so not available: ") + dlerror());
      return a;
    }
#define LOAD(field, name) a.field = reinterpret_cast<decltype(a.field)>(dlsym(lib, name))
    LOAD(create, "mpv_create");
    LOAD(initialize, "mpv_initialize");
    LOAD(terminate_destroy, "mpv_terminate_destroy");
    LOAD(set_option, "mpv_set_option");
    LOAD(set_option_string, "mpv_set_option_string");
    LOAD(set_property_string, "mpv_set_property_string");
    LOAD(get_property, "mpv_get_property");
    LOAD(get_property_string, "mpv_get_property_string");
    LOAD(command_async, "mpv_command_async");
    LOAD(observe_property, "mpv_observe_property");
    LOAD(wait_event, "mpv_wait_event");
    LOAD(wakeup, "mpv_wakeup");
    LOAD(request_log_messages, "mpv_request_log_messages");
    LOAD(stream_cb_add_ro, "mpv_stream_cb_add_ro");
    LOAD(free, "mpv_free");
    LOAD(free_node_contents, "mpv_free_node_contents");
    LOAD(error_string, "mpv_error_string");
#undef LOAD
    a.ok = a.create && a.initialize && a.terminate_destroy && a.set_option && a.set_option_string &&
        a.set_property_string && a.get_property && a.get_property_string && a.command_async && a.observe_property &&
        a.wait_event && a.wakeup && a.request_log_messages && a.stream_cb_add_ro && a.free && a.free_node_contents &&
        a.error_string;
    if (!a.ok)
      LogTo("mpv", "libmpv.so lacks functions this engine uses");
    return a;
  }();
  return api;
}

// Observed properties (reply_userdata).
enum : uint64_t { kTimePos = 1, kEofReached = 2, kDuration = 3 };

std::string WithoutQuery(const std::string &url) {
  return url.substr(0, url.find('?'));
}

bool IsHttp(const std::string &url) {
  return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

const mpv_node *MapGet(const mpv_node &map, const char *key) {
  if (map.format != MPV_FORMAT_NODE_MAP)
    return nullptr;
  for (int i = 0; i < map.u.list->num; ++i)
    if (std::string(map.u.list->keys[i]) == key)
      return &map.u.list->values[i];
  return nullptr;
}

std::string NodeString(const mpv_node *n) {
  return n && n->format == MPV_FORMAT_STRING ? n->u.string : "";
}

int64_t NodeInt(const mpv_node *n, int64_t fallback = -1) {
  if (!n)
    return fallback;
  if (n->format == MPV_FORMAT_INT64)
    return n->u.int64;
  if (n->format == MPV_FORMAT_DOUBLE)
    return int64_t(n->u.double_);
  return fallback;
}

bool NodeFlag(const mpv_node *n) {
  return n && n->format == MPV_FORMAT_FLAG && n->u.flag;
}

} // namespace

// A stream mpv reads through the stream callbacks: a ByteSource (the C++ cache).
struct MpvPlayer::Stream {
  std::unique_ptr<ByteSource> source;
  MpvPlayer *owner = nullptr;

  static int64_t Read(void *cookie, char *buf, uint64_t nbytes) {
    auto *s = static_cast<Stream *>(cookie);
    const int n = s->source->Read(reinterpret_cast<uint8_t *>(buf), int(std::min<uint64_t>(nbytes, INT_MAX)));
    return n >= 0 ? n : -1;
  }
  static int64_t Seek(void *cookie, int64_t offset) {
    const int64_t r = static_cast<Stream *>(cookie)->source->Seek(offset, SEEK_SET);
    return r >= 0 ? r : MPV_ERROR_GENERIC;
  }
  static int64_t Size(void *cookie) {
    const int64_t r = static_cast<Stream *>(cookie)->source->Seek(0, AVSEEK_SIZE);
    return r >= 0 ? r : MPV_ERROR_UNSUPPORTED;
  }
  static void Cancel(void *cookie) { static_cast<Stream *>(cookie)->source->Abort(); }
  static void Close(void *cookie) {
    auto *s = static_cast<Stream *>(cookie);
    {
      std::lock_guard lock(s->owner->m_mutex);
      if (s->owner->m_stream == s)
        s->owner->m_stream = nullptr;
    }
    delete s; // the source logs its summary as it goes
  }
};

bool MpvPlayer::Available() {
  return Api().ok;
}

MpvPlayer::MpvPlayer(int64_t wid, int width, int height, PlayerCallbacks callbacks)
    : m_callbacks(std::move(callbacks)), m_width(width), m_height(height), m_wid(wid) {
  m_track = uint64_t(reinterpret_cast<uintptr_t>(this)) * 4;
}

MpvPlayer::~MpvPlayer() {
  if (!m_mpv)
    return;
  m_quit = true;
  Api().wakeup(m_mpv);
  if (m_events.joinable())
    m_events.join();
  Api().terminate_destroy(m_mpv); // cancels the streams (Stream::Cancel), joins mpv's threads
  if (!m_restarted) {
    LIBAV_TRACE_END(m_track);
    LIBAV_TRACE_END(m_track + 1);
    LIBAV_TRACE_END(m_track + 2);
  }
}

void MpvPlayer::SetOption(const char *name, const std::string &value) {
  if (const int r = Api().set_option_string(m_mpv, name, value.c_str()); r < 0)
    LogTo("mpv", std::string("option ") + name + "=" + value + ": " + Api().error_string(r));
}

void MpvPlayer::SetProperty(const char *name, const std::string &value) {
  if (m_mpv)
    Api().set_property_string(m_mpv, name, value.c_str());
}

void MpvPlayer::Command(std::initializer_list<const char *> args) {
  if (!m_mpv)
    return;
  const char *argv[8] = {};
  size_t i = 0;
  for (const char *a : args)
    if (i < 7)
      argv[i++] = a;
  Api().command_async(m_mpv, 0, argv);
}

double MpvPlayer::PropertyDouble(const char *name, double fallback) const {
  double value = fallback;
  if (Api().get_property(m_mpv, name, MPV_FORMAT_DOUBLE, &value) < 0)
    return fallback;
  return value;
}

double MpvPlayer::SinceOpen() const {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - m_openedAt).count();
}

int MpvPlayer::OpenStream(void *user, char *uri, void *infoPtr) {
  auto *self = static_cast<MpvPlayer *>(user);
  auto *info = static_cast<mpv_stream_cb_info *>(infoPtr);
  std::string url;
  {
    std::lock_guard lock(self->m_mutex);
    auto it = self->m_urls.find(uri);
    if (it == self->m_urls.end())
      return MPV_ERROR_LOADING_FAILED;
    url = it->second;
  }
  std::unique_ptr<ByteSource> source = self->m_sourceFactory ? self->m_sourceFactory(url) : nullptr;
  if (!source)
    return MPV_ERROR_LOADING_FAILED;
  auto *stream = new Stream{std::move(source), self};
  {
    std::lock_guard lock(self->m_mutex);
    self->m_stream = stream;
  }
  info->cookie = stream;
  info->read_fn = Stream::Read;
  info->seek_fn = Stream::Seek;
  info->size_fn = Stream::Size;
  info->close_fn = Stream::Close;
  info->cancel_fn = Stream::Cancel;
  return 0;
}

void MpvPlayer::Open(std::string source, bool hardwareDecoding, int audioTrack) {
  const MpvApi &api = Api();
  if (!api.ok) {
    if (m_callbacks.onError)
      m_callbacks.onError("mpv is not available in this build");
    return;
  }
  m_hardwareDecoding = hardwareDecoding;
  m_label = WithoutQuery(source);
  m_openedAt = std::chrono::steady_clock::now();
  {
    std::lock_guard lock(m_mutex);
    m_pendingAudio = audioTrack;
  }

  m_mpv = api.create();
  if (!m_mpv) {
    if (m_callbacks.onError)
      m_callbacks.onError("mpv_create failed");
    return;
  }
  // Before mpv_initialize: the window and video output, then playback behaviour.
  api.set_option(m_mpv, "wid", MPV_FORMAT_INT64, &m_wid);
  SetOption("config", "no");
  SetOption("terminal", "no");
  SetOption("idle", "yes");
  SetOption("force-window", "no");
  SetOption("keep-open", "yes"); // the end is reported (eof-reached) and the last frame stays
  SetOption("input-default-bindings", "no");
  SetOption("input-vo-keyboard", "no");
  SetOption("osd-level", "0");
  SetOption("audio-display", "no");
  SetOption("sub-auto", "no");
  SetOption("hr-seek", "yes"); // seeks land on the frame asked for, as Player's
  SetOption("ao", "audiotrack,opensles");
  // Video: mpv's OpenGL ES output on the Surface. Hardware decoding (MediaCodec, through AImageReader: no copy) where
  // mpv has it for the codec (H.264, HEVC, VP8/9, AV1, ...); everything else is decoded in software and drawn by the
  // same output. debug.libav.mpv_vo=embed: vo=mediacodec_embed instead (MediaCodec straight to the Surface, but it
  // shows nothing decoded in software: WMV, MPEG-4 ASP, MPEG-2, 10-bit H.264, ... play without video).
  m_embedded = hardwareDecoding && DebugProperty("mpv_vo") == "embed";
  if (m_embedded) {
    SetOption("vo", "mediacodec_embed");
    SetOption("hwdec", "mediacodec");
  } else {
    SetOption("vo", "gpu");
    SetOption("gpu-context", "android");
    SetOption("opengl-es", "yes");
    SetOption("hwdec", hardwareDecoding ? "mediacodec" : "no");
    if (m_width > 0 && m_height > 0)
      SetOption("android-surface-size", std::to_string(m_width) + "x" + std::to_string(m_height));
  }
  // mpv's own buffer (the demuxer cache) on top of ours: what it reads ahead of playback.
  const std::string readahead = DebugProperty("mpv_readahead");
  const std::string maxBytes = DebugProperty("mpv_max_bytes");
  SetOption("cache", "no");
  SetOption("demuxer-readahead-secs", readahead.empty() ? "5" : readahead);
  SetOption("demuxer-max-bytes", (maxBytes.empty() ? "32" : maxBytes) + "MiB");
  SetOption("demuxer-max-back-bytes", "8MiB");
  SetOption("tls-verify", m_tlsVerify ? "yes" : "no");
  SetOption("loop-file", m_loop ? "inf" : "no");
  if (const int r = api.initialize(m_mpv); r < 0) {
    LogTo("mpv", std::string("mpv_initialize: ") + api.error_string(r));
    if (m_callbacks.onError)
      m_callbacks.onError(std::string("mpv: ") + api.error_string(r));
    return;
  }
  const std::string logLevel = DebugProperty("mpv_log");
  api.request_log_messages(m_mpv, logLevel.empty() ? "warn" : logLevel.c_str());
  api.stream_cb_add_ro(m_mpv, "covecache", this, +[](void *user, char *uri, mpv_stream_cb_info *info) -> int {
    return MpvPlayer::OpenStream(user, uri, info);
  });
  api.observe_property(m_mpv, kTimePos, "time-pos", MPV_FORMAT_DOUBLE);
  api.observe_property(m_mpv, kEofReached, "eof-reached", MPV_FORMAT_FLAG);
  api.observe_property(m_mpv, kDuration, "duration", MPV_FORMAT_DOUBLE);

  // http(s) through the cache (stream callbacks), unless mpv_input=url: then mpv's own HTTP, with the header.
  std::string target = source;
  if (IsHttp(source)) {
    if (DebugProperty("mpv_input") != "url" && m_sourceFactory) {
      std::lock_guard lock(m_mutex);
      target = "covecache://" + std::to_string(++m_nextUrl);
      m_urls[target] = source;
    } else {
      std::string headers = HttpCache::Headers(source); // "Authorization: ...\r\n"
      while (!headers.empty() && (headers.back() == '\n' || headers.back() == '\r'))
        headers.pop_back();
      if (!headers.empty())
        SetProperty("http-header-fields", headers);
    }
  }

#if defined(LIBAV_RNTRACE)
  rntrace_name_track(m_track, ("mpv " + m_label).c_str());
  rntrace_name_track(m_track + 1, ("mpv vconfig " + m_label).c_str());
  rntrace_name_track(m_track + 2, ("mpv restart " + m_label).c_str());
#endif
  LIBAV_TRACE_BEGIN("mpv open → file-loaded", m_track);
  LIBAV_TRACE_BEGIN("mpv open → video-reconfig", m_track + 1);
  LIBAV_TRACE_BEGIN("mpv open → playback-restart", m_track + 2);
  m_events = std::thread([this] { Events(); });
  Command({"loadfile", target.c_str()});
}

void MpvPlayer::SetSurfaceSize(int width, int height) {
  m_width = width;
  m_height = height;
  if (!m_embedded && width > 0 && height > 0)
    SetProperty("android-surface-size", std::to_string(width) + "x" + std::to_string(height));
}

void MpvPlayer::SetPaused(bool paused) {
  SetProperty("pause", paused ? "yes" : "no");
}

void MpvPlayer::SetMuted(bool muted) {
  SetProperty("mute", muted ? "yes" : "no");
}

void MpvPlayer::SetVolume(float volume) {
  SetProperty("volume", std::to_string(int(std::clamp(volume, 0.0f, 1.0f) * 100)));
}

void MpvPlayer::SetLoop(bool loop) {
  m_loop = loop;
  SetProperty("loop-file", loop ? "inf" : "no");
}

void MpvPlayer::Seek(double seconds) {
  m_seeking = true;
  const std::string target = std::to_string(seconds);
  Command({"seek", target.c_str(), "absolute+exact"});
}

void MpvPlayer::SetAudioTrack(int index) {
  if (!m_loaded) {
    std::lock_guard lock(m_mutex);
    m_pendingAudio = index;
    return;
  }
  SelectAudio(index);
}

// mpv numbers its tracks itself: the audio track whose ff-index is streamIndex (-1: mpv's choice).
void MpvPlayer::SelectAudio(int streamIndex) {
  if (streamIndex < 0) {
    SetProperty("aid", "auto");
    return;
  }
  mpv_node tracks{};
  if (Api().get_property(m_mpv, "track-list", MPV_FORMAT_NODE, &tracks) < 0)
    return;
  if (tracks.format == MPV_FORMAT_NODE_ARRAY) {
    for (int i = 0; i < tracks.u.list->num; ++i) {
      const mpv_node &t = tracks.u.list->values[i];
      if (NodeString(MapGet(t, "type")) == "audio" && NodeInt(MapGet(t, "ff-index")) == streamIndex) {
        SetProperty("aid", std::to_string(NodeInt(MapGet(t, "id"))));
        break;
      }
    }
  }
  Api().free_node_contents(&tracks);
}

// The load event: the video's size once mpv has configured its output (video-reconfig), or at file-loaded for a
// source without video.
void MpvPlayer::Loaded() {
  const MpvApi &api = Api();
  MediaInfo info;
  info.duration = PropertyDouble("duration");
  m_duration = info.duration;
  int64_t w = 0, h = 0;
  api.get_property(m_mpv, "dwidth", MPV_FORMAT_INT64, &w);
  api.get_property(m_mpv, "dheight", MPV_FORMAT_INT64, &h);
  info.width = int(w);
  info.height = int(h);
  info.aspect = h > 0 ? double(w) / double(h) : 0;
  if (char *hw = api.get_property_string(m_mpv, "hwdec-current")) {
    info.hwDecoding = std::string(hw) != "no" && *hw;
    api.free(hw);
  }
  if (char *codec = api.get_property_string(m_mpv, "video-format")) {
    info.codec = codec;
    api.free(codec);
  }
  mpv_node tracks{};
  if (api.get_property(m_mpv, "track-list", MPV_FORMAT_NODE, &tracks) >= 0 && tracks.format == MPV_FORMAT_NODE_ARRAY) {
    for (int i = 0; i < tracks.u.list->num; ++i) {
      const mpv_node &t = tracks.u.list->values[i];
      if (NodeString(MapGet(t, "type")) != "audio")
        continue;
      AudioTrackInfo a;
      a.index = int(NodeInt(MapGet(t, "ff-index")));
      a.language = NodeString(MapGet(t, "lang"));
      a.title = NodeString(MapGet(t, "title"));
      a.codec = NodeString(MapGet(t, "codec"));
      a.channels = int(NodeInt(MapGet(t, "demux-channel-count"), 0));
      a.sampleRate = int(NodeInt(MapGet(t, "demux-samplerate"), 0));
      if (NodeFlag(MapGet(t, "selected")))
        info.audioTrack = a.index;
      info.audioTracks.push_back(std::move(a));
    }
    api.free_node_contents(&tracks);
  }
  info.hasAudio = !info.audioTracks.empty();
  if (m_callbacks.onLoad)
    m_callbacks.onLoad(info);
}

void MpvPlayer::LogStartup(const char *stage) {
  std::string summary;
  {
    std::lock_guard lock(m_mutex);
    if (m_stream)
      summary = m_stream->source->Summary();
  }
  char line[512];
  snprintf(line, sizeof(line), "mpv startup %.0f ms to %s: file-loaded %.0f, video-reconfig %.0f (%s)%s%s %s",
           SinceOpen(), stage, m_loadedMs, m_reconfigMs, m_embedded ? "mediacodec_embed" : "gpu",
           summary.empty() ? "" : " | ", summary.c_str(), m_label.c_str());
  Log(line);
}

void MpvPlayer::Events() {
  SetThreadName("mpv events");
  const MpvApi &api = Api();
  // debug.libav.mpv_stats=1: once a second, where playback is against the wall clock (logcat tag libav).
  const bool stats = DebugProperty("mpv_stats") == "1";
  auto lastStats = std::chrono::steady_clock::now();
  while (!m_quit) {
    mpv_event *e = api.wait_event(m_mpv, stats ? 0.25 : -1);
    if (stats && std::chrono::steady_clock::now() - lastStats >= std::chrono::seconds(1)) {
      lastStats = std::chrono::steady_clock::now();
      int64_t vo = 0, dec = 0;
      api.get_property(m_mpv, "frame-drop-count", MPV_FORMAT_INT64, &vo);
      api.get_property(m_mpv, "decoder-frame-drop-count", MPV_FORMAT_INT64, &dec);
      char line[256];
      snprintf(line, sizeof(line), "mpv stats: wall %.1f s, time-pos %.2f, audio-pts %.2f, avsync %.3f, fps %.1f, "
               "dropped vo %lld dec %lld, speed %.2f", SinceOpen() / 1000, PropertyDouble("time-pos", -1),
               PropertyDouble("audio-pts", -1), PropertyDouble("avsync"), PropertyDouble("estimated-vf-fps"),
               (long long)vo, (long long)dec, PropertyDouble("speed", -1));
      Log(line);
    }
    if (m_quit || e->event_id == MPV_EVENT_SHUTDOWN)
      break;
    switch (e->event_id) {
      case MPV_EVENT_LOG_MESSAGE: {
        auto *m = static_cast<mpv_event_log_message *>(e->data);
        std::string text = std::string("[") + m->prefix + "] " + m->text;
        while (!text.empty() && text.back() == '\n')
          text.pop_back();
        LogTo("mpv", text);
        break;
      }
      case MPV_EVENT_FILE_LOADED: {
        m_loaded = true;
        m_loadedMs = SinceOpen();
        LIBAV_TRACE_END(m_track);
        int pending;
        {
          std::lock_guard lock(m_mutex);
          pending = m_pendingAudio;
        }
        if (pending >= 0)
          SelectAudio(pending);
        char *video = api.get_property_string(m_mpv, "current-tracks/video/id");
        const bool hasVideo = video != nullptr;
        if (video)
          api.free(video);
        if (!hasVideo)
          Loaded();
        break;
      }
      case MPV_EVENT_VIDEO_RECONFIG:
        if (m_loaded && !m_reconfigured) {
          m_reconfigured = true;
          m_reconfigMs = SinceOpen();
          LIBAV_TRACE_END(m_track + 1);
          Loaded();
        }
        break;
      case MPV_EVENT_PLAYBACK_RESTART: {
        const double t = PropertyDouble("time-pos");
        if (!m_restarted) {
          // The first frame is out: report progress now (the app takes the first progress as "on screen").
          m_restarted = true;
          LIBAV_TRACE_END(m_track + 2);
          LogStartup("restart");
          m_lastProgressAt = std::chrono::steady_clock::now();
          if (m_callbacks.onProgress)
            m_callbacks.onProgress(t, m_duration);
        }
        if (m_seeking) {
          m_seeking = false;
          m_ended = false;
          if (m_callbacks.onSeek)
            m_callbacks.onSeek(t);
        }
        break;
      }
      case MPV_EVENT_PROPERTY_CHANGE: {
        auto *p = static_cast<mpv_event_property *>(e->data);
        if (e->reply_userdata == kTimePos && p->format == MPV_FORMAT_DOUBLE && m_restarted && !m_seeking) {
          const double t = *static_cast<double *>(p->data);
          const auto now = std::chrono::steady_clock::now();
          if (now - m_lastProgressAt >= std::chrono::milliseconds(250)) {
            m_lastProgressAt = now;
            if (m_callbacks.onProgress)
              m_callbacks.onProgress(t, m_duration);
          }
        } else if (e->reply_userdata == kDuration && p->format == MPV_FORMAT_DOUBLE) {
          m_duration = *static_cast<double *>(p->data);
        } else if (e->reply_userdata == kEofReached && p->format == MPV_FORMAT_FLAG) {
          const bool eof = *static_cast<int *>(p->data) != 0;
          if (eof && !m_ended && !m_loop) {
            m_ended = true;
            if (m_callbacks.onEnd)
              m_callbacks.onEnd();
          }
        }
        break;
      }
      case MPV_EVENT_END_FILE: {
        auto *end = static_cast<mpv_event_end_file *>(e->data);
        if (end->reason == MPV_END_FILE_REASON_ERROR && m_callbacks.onError)
          m_callbacks.onError(std::string("mpv: ") + api.error_string(end->error));
        break;
      }
      default:
        break;
    }
  }
}

} // namespace ReactNativeLibav

#else // no libmpv headers at build time: the engine is unavailable

namespace ReactNativeLibav {

struct MpvPlayer::Stream {};
bool MpvPlayer::Available() { return false; }
MpvPlayer::MpvPlayer(int64_t, int, int, PlayerCallbacks callbacks) : m_callbacks(std::move(callbacks)) {}
MpvPlayer::~MpvPlayer() = default;
void MpvPlayer::Open(std::string, bool, int) {
  if (m_callbacks.onError)
    m_callbacks.onError("mpv is not in this build");
}
void MpvPlayer::SetPaused(bool) {}
void MpvPlayer::SetSurfaceSize(int, int) {}
void MpvPlayer::SetMuted(bool) {}
void MpvPlayer::SetVolume(float) {}
void MpvPlayer::SetLoop(bool) {}
void MpvPlayer::Seek(double) {}
void MpvPlayer::SetAudioTrack(int) {}

} // namespace ReactNativeLibav

#endif
