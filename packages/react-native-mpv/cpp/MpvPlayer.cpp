#include "MpvPlayer.h"

#include "HttpCache.h"
#include "Platform.h"
#include "Trace.h"

#if !defined(_WIN32)
#include <dlfcn.h>
#endif
#include <mpv/client.h>
#include <mpv/stream_cb.h>

#include <algorithm>
#include <climits>
#include <cstdio>

namespace ReactNativeMpv {

namespace {

#if defined(_WIN32)
constexpr const char *kLibrary = "libmpv-2.dll";
constexpr const char *kVideoOutput = "d3d11";
void *OpenLibrary(std::string &error) {
  HMODULE lib = LoadLibraryW(L"libmpv-2.dll");
  if (!lib)
    error = "LoadLibrary error " + std::to_string(GetLastError());
  return lib;
}
void *Symbol(void *lib, const char *name) {
  return reinterpret_cast<void *>(GetProcAddress(static_cast<HMODULE>(lib), name));
}
#else
constexpr const char *kLibrary = "libmpv.so";
constexpr const char *kVideoOutput = "gpu";
void *OpenLibrary(std::string &error) {
  void *lib = dlopen("libmpv.so", RTLD_NOW);
  if (!lib)
    error = dlerror();
  return lib;
}
void *Symbol(void *lib, const char *name) {
  return dlsym(lib, name);
}
#endif

// libmpv's C API, loaded at run time (the pointers have the headers' types): libmpv.so on Android
// (scripts/mpv-android), libmpv-2.dll next to the app on Windows (scripts/mpv-windows); both in third_party/mpv.
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
    std::string error;
    void *lib = OpenLibrary(error);
    if (!lib) {
      LogTo("mpv", std::string(kLibrary) + " not available: " + error);
      return a;
    }
#define LOAD(field, name) a.field = reinterpret_cast<decltype(a.field)>(Symbol(lib, name))
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
      LogTo("mpv", std::string(kLibrary) + " lacks functions this engine uses");
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
    const int64_t r = static_cast<Stream *>(cookie)->source->Seek(0, kSeekSize);
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
    MPV_TRACE_END(m_track);
    MPV_TRACE_END(m_track + 1);
    MPV_TRACE_END(m_track + 2);
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

namespace {
std::string g_fontsDir, g_fontFamily; // SetSubtitleFonts; read by Open (both on the main thread)
} // namespace

void MpvPlayer::SetSubtitleFonts(std::string dir, std::string family) {
  g_fontsDir = std::move(dir);
  g_fontFamily = std::move(family);
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
#if !defined(_WIN32)
  api.set_option(m_mpv, "wid", MPV_FORMAT_INT64, &m_wid);
#endif
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
  if (!g_fontsDir.empty()) {
    SetOption("sub-fonts-dir", g_fontsDir);
    SetOption("sub-font", g_fontFamily); // also the fallback for ASS styles whose font is missing
  }
  SetOption("hr-seek", "yes"); // seeks land on the frame asked for, as Player's
#if defined(_WIN32)
  // Video: mpv's D3D11 renderer on the view's device, with no window and no swapchain anyone shows: each frame goes to
  // the view's composition hook (scripts/mpv-windows/patches, <mpv/d3d11_composition.h>), which copies it into the
  // view's composition surface. D3D11VA decoding where the GPU has the codec, software decoding otherwise; subtitle
  // fonts from DirectWrite.
  SetOption("ao", "wasapi");
  SetOption("vo", "gpu");
  SetOption("gpu-context", "d3d11");
  SetOption("d3d11-output-mode", "composition");
  SetOption("d3d11-output-format", "bgra8"); // the composition surface's format: frames are copied as they are
  SetOption("d3d11-composition-size",
            std::to_string(std::max(m_width, 16)) + "x" + std::to_string(std::max(m_height, 16)));
  int64_t device = int64_t(reinterpret_cast<intptr_t>(m_d3d11Device));
  int64_t hook = int64_t(reinterpret_cast<intptr_t>(m_compositionHook));
  api.set_option(m_mpv, "d3d11-composition-device", MPV_FORMAT_INT64, &device);
  api.set_option(m_mpv, "d3d11-composition-hook", MPV_FORMAT_INT64, &hook);
  SetOption("hwdec", hardwareDecoding ? "d3d11va" : "no");
#else
  SetOption("ao", "audiotrack,opensles");
  // Video: mpv's OpenGL ES output on the Surface. Hardware decoding (MediaCodec, through AImageReader: no copy) where
  // mpv has it for the codec (H.264, HEVC, VP8/9, AV1, ...); everything else is decoded in software and drawn by the
  // same output. debug.mpv.vo=embed: vo=mediacodec_embed instead (MediaCodec straight to the Surface, but it
  // shows nothing decoded in software: WMV, MPEG-4 ASP, MPEG-2, 10-bit H.264, ... play without video).
  m_embedded = hardwareDecoding && DebugProperty("vo") == "embed";
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
#endif
  // mpv's own buffer (the demuxer cache) on top of ours: what it reads ahead of playback.
  const std::string readahead = DebugProperty("readahead");
  const std::string maxBytes = DebugProperty("max_bytes");
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
  const std::string logLevel = DebugProperty("log");
  api.request_log_messages(m_mpv, logLevel.empty() ? "warn" : logLevel.c_str());
  api.stream_cb_add_ro(m_mpv, "covecache", this, +[](void *user, char *uri, mpv_stream_cb_info *info) -> int {
    return MpvPlayer::OpenStream(user, uri, info);
  });
  api.observe_property(m_mpv, kTimePos, "time-pos", MPV_FORMAT_DOUBLE);
  api.observe_property(m_mpv, kEofReached, "eof-reached", MPV_FORMAT_FLAG);
  api.observe_property(m_mpv, kDuration, "duration", MPV_FORMAT_DOUBLE);

  // http(s) through the cache (stream callbacks), unless the input=url switch: then mpv's own HTTP, with the header.
  std::string target = source;
  if (IsHttp(source)) {
    if (DebugProperty("input") != "url" && m_sourceFactory) {
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

#if defined(MPV_RNTRACE)
  rntrace_name_track(m_track, ("mpv " + m_label).c_str());
  rntrace_name_track(m_track + 1, ("mpv vconfig " + m_label).c_str());
  rntrace_name_track(m_track + 2, ("mpv restart " + m_label).c_str());
  rntrace_name_track(m_track + 3, ("mpv seek " + m_label).c_str());
#endif
  MPV_TRACE_BEGIN("mpv open → file-loaded", m_track);
  MPV_TRACE_BEGIN("mpv open → video-reconfig", m_track + 1);
  MPV_TRACE_BEGIN("mpv open → playback-restart", m_track + 2);
  m_events = std::thread([this] { Events(); });
  Command({"loadfile", target.c_str()});
}

void MpvPlayer::SetSurfaceSize(int width, int height) {
  m_width = width;
  m_height = height;
  if (m_embedded || width <= 0 || height <= 0)
    return;
#if defined(_WIN32)
  SetProperty("d3d11-composition-size", std::to_string(width) + "x" + std::to_string(height)); // mpv redraws at it
#else
  SetProperty("android-surface-size", std::to_string(width) + "x" + std::to_string(height));
#endif
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

void MpvPlayer::SetSpeed(double speed) {
  SetProperty("speed", std::to_string(speed > 0 ? speed : 1.0));
}

void MpvPlayer::Seek(double seconds) {
  const double from = PropertyDouble("time-pos", -1);
  int number, superseded;
  {
    std::lock_guard lock(m_mutex);
    superseded = m_seeksPending;
    number = ++m_seekCount;
    ++m_seeksPending;
    m_seekAt = std::chrono::steady_clock::now();
    m_seekFrom = from;
    m_seekTarget = seconds;
    m_seekSummary = m_stream ? m_stream->source->Summary() : "";
  }
  if (superseded)
    MPV_TRACE_END(m_track + 3);
  MPV_TRACE_BEGIN("seek → playback-restart", m_track + 3);
  char line[160];
  snprintf(line, sizeof(line), "seek #%d %.2f → %.2f s%s %s", number, from, seconds,
           superseded ? " (the one before not done)" : "", m_label.c_str());
  LogTo("MpvSeek", line);
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
  SelectTrack("audio", "aid", index);
}

void MpvPlayer::SetSubtitleTrack(int index) {
  if (!m_loaded) {
    std::lock_guard lock(m_mutex);
    m_pendingSubtitle = index;
    return;
  }
  SelectTrack("sub", "sid", index);
}

// mpv numbers its tracks itself: the track of this type whose ff-index is streamIndex (kSubtitleDefault, -1: mpv's
// choice; kSubtitleOff, -2: none).
void MpvPlayer::SelectTrack(const char *type, const char *property, int streamIndex) {
  if (streamIndex < 0) {
    SetProperty(property, streamIndex == kSubtitleOff ? "no" : "auto");
    return;
  }
  mpv_node tracks{};
  if (Api().get_property(m_mpv, "track-list", MPV_FORMAT_NODE, &tracks) < 0)
    return;
  if (tracks.format == MPV_FORMAT_NODE_ARRAY) {
    for (int i = 0; i < tracks.u.list->num; ++i) {
      const mpv_node &t = tracks.u.list->values[i];
      if (NodeString(MapGet(t, "type")) == type && NodeInt(MapGet(t, "ff-index")) == streamIndex) {
        SetProperty(property, std::to_string(NodeInt(MapGet(t, "id"))));
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
  // The display size (aspect applied) as the filters output it: set by the time of the reconfig event, where dwidth
  // (video-out-params) may still be unset until the VO thread has taken the new format.
  int64_t w = 0, h = 0;
  if (api.get_property(m_mpv, "video-params/dw", MPV_FORMAT_INT64, &w) < 0 || w <= 0)
    api.get_property(m_mpv, "dwidth", MPV_FORMAT_INT64, &w);
  if (api.get_property(m_mpv, "video-params/dh", MPV_FORMAT_INT64, &h) < 0 || h <= 0)
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
      const std::string type = NodeString(MapGet(t, "type"));
      if (type == "sub") {
        SubtitleTrackInfo s;
        s.index = int(NodeInt(MapGet(t, "ff-index")));
        s.language = NodeString(MapGet(t, "lang"));
        s.title = NodeString(MapGet(t, "title"));
        s.codec = NodeString(MapGet(t, "codec"));
        s.isDefault = NodeFlag(MapGet(t, "default"));
        s.forced = NodeFlag(MapGet(t, "forced"));
        if (NodeFlag(MapGet(t, "selected")))
          info.subtitleTrack = s.index;
        info.subtitleTracks.push_back(std::move(s));
        continue;
      }
      if (type != "audio")
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
           SinceOpen(), stage, m_loadedMs, m_reconfigMs, m_embedded ? "mediacodec_embed" : kVideoOutput,
           summary.empty() ? "" : " | ", summary.c_str(), m_label.c_str());
  Log(line);
}

void MpvPlayer::Events() {
  SetThreadName("mpv events");
  const MpvApi &api = Api();
  // debug.mpv.stats=1: once a second, where playback is against the wall clock.
  const bool stats = DebugProperty("stats") == "1";
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
        MPV_TRACE_END(m_track);
        int audio, subtitle;
        {
          std::lock_guard lock(m_mutex);
          audio = m_pendingAudio;
          subtitle = m_pendingSubtitle;
        }
        if (audio >= 0)
          SelectTrack("audio", "aid", audio);
        if (subtitle != kSubtitleDefault)
          SelectTrack("sub", "sid", subtitle);
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
          MPV_TRACE_END(m_track + 1);
          Loaded();
        }
        break;
      case MPV_EVENT_PLAYBACK_RESTART: {
        const double t = PropertyDouble("time-pos");
        if (!m_restarted) {
          // The first frame is out: report progress now (the app takes the first progress as "on screen").
          m_restarted = true;
          MPV_TRACE_END(m_track + 2);
          LogStartup("restart");
          m_lastProgressAt = std::chrono::steady_clock::now();
          if (m_callbacks.onProgress)
            m_callbacks.onProgress(t, m_duration);
        }
        if (m_seeking) {
          m_seeking = false;
          m_ended = false;
          double ms, target;
          int number;
          std::string before, after;
          {
            std::lock_guard lock(m_mutex);
            ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - m_seekAt).count();
            target = m_seekTarget;
            number = m_seekCount;
            m_seeksPending = 0;
            before = m_seekSummary;
            after = m_stream ? m_stream->source->Summary() : "";
          }
          MPV_TRACE_END(m_track + 3);
          char line[1024];
          snprintf(line, sizeof(line), "seek #%d to %.2f s done in %.0f ms, at %.3f s | cache before: %s | after: %s %s",
                   number, target, ms, t, before.c_str(), after.c_str(), m_label.c_str());
          LogTo("MpvSeek", line);
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

} // namespace ReactNativeMpv
