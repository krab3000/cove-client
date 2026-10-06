#include "pch.h"

#include "VlcVideoView.h"

#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Windows.UI.h>
#include <winrt/Microsoft.UI.Composition.interop.h>

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <mutex>
#include <set>
#include <thread>

#include "codegen/react/components/VlcSpec/VlcVideoView.g.h"
#include "VlcRenderer.h"

namespace Codegen = ReactNativeVlcCodegen;
namespace RN = winrt::Microsoft::ReactNative;
namespace Composition = winrt::Microsoft::UI::Composition;

namespace {

using namespace ReactNativeVlc;

constexpr ULONGLONG kProgressPeriodMs = 250;

// The last error VLC logged, for onError (libVLC's events only say that playback failed).
std::mutex g_errorLock;
std::string g_lastError;

void Log(void *, int level, const libvlc_log_t *, const char *fmt, va_list args) {
  if (level < LIBVLC_WARNING)
    return;
  char message[1024];
  vsnprintf(message, sizeof(message), fmt, args);
  OutputDebugStringA((std::string(level == LIBVLC_ERROR ? "[vlc error] " : "[vlc warning] ") + message + "\n").c_str());
  if (level == LIBVLC_ERROR) {
    std::lock_guard lock(g_errorLock);
    g_lastError = message;
  }
}

std::string LastError(const char *fallback) {
  std::lock_guard lock(g_errorLock);
  return g_lastError.empty() ? fallback : g_lastError;
}

// Servers whose certificate VLC may accept without verifying it (sources played with tlsVerify={false}). VLC's TLS
// asks through a dialog when it cannot verify a certificate; these are answered here.
std::mutex g_hostsLock;
std::set<std::string> g_insecureHosts;

std::string Lowercase(std::string text) {
  std::transform(text.begin(), text.end(), text.begin(), [](unsigned char c) { return char(tolower(c)); });
  return text;
}

// "https://user@host:port/path" -> "host".
std::string UrlHost(const std::string &url) {
  const auto scheme = url.find("://");
  if (scheme == std::string::npos)
    return {};
  std::string authority = url.substr(scheme + 3, url.find_first_of("/?#", scheme + 3) - (scheme + 3));
  if (const auto at = authority.rfind('@'); at != std::string::npos)
    authority.erase(0, at + 1);
  if (!authority.empty() && authority[0] == '[') // IPv6 literal
    return Lowercase(authority.substr(1, authority.find(']') - 1));
  return Lowercase(authority.substr(0, authority.find(':')));
}

void AllowUnverified(const std::string &host) {
  if (host.empty())
    return;
  std::lock_guard lock(g_hostsLock);
  g_insecureHosts.insert(host);
}

const libvlc_dialog_cbs *DialogCallbacks() {
  static const libvlc_dialog_cbs callbacks = [] {
    libvlc_dialog_cbs cbs{};
    cbs.pf_display_error = [](void *, const char *, const char *) {};
    cbs.pf_display_login = [](void *, libvlc_dialog_id *id, const char *, const char *, const char *, bool) {
      libvlc_dialog_dismiss(id);
    };
    // "Insecure site" (twice: then the certificate, "Accept 24 hours" is action 1). The text names the server; the
    // titles and buttons may be translated, so they are not matched.
    cbs.pf_display_question = [](void *, libvlc_dialog_id *id, const char *title, const char *text,
                                 libvlc_dialog_question_type, const char *, const char *, const char *) {
      const std::string message = Lowercase(std::string(title ? title : "") + " " + (text ? text : ""));
      bool allowed = false;
      {
        std::lock_guard lock(g_hostsLock);
        for (const auto &host : g_insecureHosts)
          allowed = allowed || message.find(host) != std::string::npos;
      }
      if (allowed)
        libvlc_dialog_post_action(id, 1);
      else
        libvlc_dialog_dismiss(id);
    };
    cbs.pf_display_progress = [](void *, libvlc_dialog_id *, const char *, const char *, bool, float,
                                 const char *) {};
    cbs.pf_cancel = [](void *, libvlc_dialog_id *id) { libvlc_dialog_dismiss(id); };
    cbs.pf_update_progress = [](void *, libvlc_dialog_id *, float, const char *) {};
    return cbs;
  }();
  return &callbacks;
}

// One libVLC instance for the process (plugins are loaded once), created on first use.
libvlc_instance_t *Instance() {
  static libvlc_instance_t *instance = [] {
    const char *args[] = {
        "--no-video-title-show",
        "--no-osd",
        "--no-snapshot-preview",
        // DirectSound: volume and mute per player. (WASAPI's mmdevice sets the volume of the process's audio
        // session, which all players share and Windows remembers.)
        "--aout=directsound,any",
        // File and network caching stay at VLC's 1 s: in VLC 3 they are also how far ahead of the display the
        // pictures are decoded, and with 300 ms a 4K HEVC hardware decode delivered a third of its frames too late.
    };
    libvlc_instance_t *vlc = libvlc_new(int(std::size(args)), args);
    if (!vlc) // an option this build does not know
      vlc = libvlc_new(0, nullptr);
    if (vlc) {
      libvlc_log_set(vlc, Log, nullptr);
      libvlc_dialog_set_callbacks(vlc, DialogCallbacks(), nullptr);
    }
    return vlc;
  }();
  return instance;
}

// "H264 - MPEG-4 AVC (part 10)" -> "H264".
std::string CodecName(libvlc_track_type_t type, uint32_t codec) {
  const char *description = libvlc_media_get_codec_description(type, codec);
  std::string name = description ? description : "";
  if (const auto dash = name.find(" - "); dash != std::string::npos)
    name.resize(dash);
  return name;
}

struct VlcVideoView;

// One playback: the player, the renderer it draws through, and the view it reports to. VLC's events get the session
// and post to the view on the UI thread, where they are dropped once the view moved on (generation).
struct Session {
  winrt::weak_ref<VlcVideoView> view;
  uint64_t generation = 0;
  RN::IReactDispatcher dispatcher{nullptr};
  std::shared_ptr<VlcRenderer> renderer;
  libvlc_media_player_t *player = nullptr;

  template <typename F>
  void Post(F &&fn);

  ~Session() {
    if (player) {
      libvlc_media_player_stop(player); // joins VLC's threads and cleans up the renderer
      libvlc_media_player_release(player);
    }
  }
};

constexpr libvlc_event_type_t kPlayerEvents[] = {
    libvlc_MediaPlayerPlaying, libvlc_MediaPlayerPaused,      libvlc_MediaPlayerEndReached,
    libvlc_MediaPlayerEncounteredError, libvlc_MediaPlayerTimeChanged, libvlc_MediaPlayerLengthChanged,
    libvlc_MediaPlayerESAdded, libvlc_MediaPlayerESSelected,  libvlc_MediaPlayerVout,
};

// <VlcVideoView>: a SpriteVisual showing a GPU composition surface that libVLC renders into from its own threads.
// Each source gets a new player and renderer; the previous ones are released on a background thread.
struct VlcVideoView : winrt::implements<VlcVideoView, winrt::Windows::Foundation::IInspectable>,
                      Codegen::BaseVlcVideoView<VlcVideoView> {
  ~VlcVideoView() {
    Shutdown();
  }

  void Initialize(const RN::ComponentView &view) noexcept override {
    m_dispatcher = view.ReactContext().UIDispatcher();
    m_destroyingRevoker = view.Destroying(winrt::auto_revoke, [weak = get_weak()](auto &&, auto &&) {
      if (auto self = weak.get())
        self->Shutdown();
    });
  }

  Composition::Visual CreateVisual(const RN::ComponentView &view) noexcept override {
    m_compositor = view.as<RN::Composition::ViewComponentView>().Compositor();
    // RNW owns the brush of the visual we return (it is the view's backgroundColor); the video goes on a child.
    auto visual = m_compositor.CreateSpriteVisual();
    m_content = m_compositor.CreateSpriteVisual();
    m_content.RelativeSizeAdjustment({1, 1});
    visual.Children().InsertAtTop(m_content);
    return visual;
  }

  void UpdateLayoutMetrics(const RN::ComponentView & /*view*/, const RN::LayoutMetrics &newMetrics,
                           const RN::LayoutMetrics & /*oldMetrics*/) noexcept override {
    const float width = newMetrics.Frame.Width * newMetrics.PointScaleFactor;
    const float height = newMetrics.Frame.Height * newMetrics.PointScaleFactor;
    if (width >= 1 && height >= 1) {
      m_size[0] = unsigned(width + 0.5f);
      m_size[1] = unsigned(height + 0.5f);
      if (m_session)
        m_session->renderer->Resize(m_size[0], m_size[1]);
    }
  }

  void UpdateProps(const RN::ComponentView &view, const winrt::com_ptr<Codegen::VlcVideoViewProps> &newProps,
                   const winrt::com_ptr<Codegen::VlcVideoViewProps> &oldProps) noexcept override {
    BaseVlcVideoView::UpdateProps(view, newProps, oldProps);
    if (!newProps)
      return;
    const bool paused = newProps->paused.value_or(false);
    const bool muted = newProps->muted.value_or(false);
    const float volume = newProps->volume;
    const float rate = newProps->rate;
    const int audioTrack = newProps->audioTrack;
    const int subtitleTrack = newProps->subtitleTrack;

    const std::string source = newProps->source.value_or("");
    const bool hardware = newProps->hardwareDecoding;
    const bool loop = newProps->loop.value_or(false);
    const bool cache = newProps->cache.value_or(false);
    const bool tlsVerify = newProps->tlsVerify;
    const std::string demux = newProps->demux.value_or("");
    if (source != m_source || hardware != m_hardware || loop != m_loop || cache != m_cache ||
        tlsVerify != m_tlsVerify || demux != m_demux || !m_propsSet) {
      m_propsSet = true;
      m_source = source;
      m_hardware = hardware;
      m_loop = loop;
      m_cache = cache;
      m_tlsVerify = tlsVerify;
      m_demux = demux;
      m_paused = paused;
      m_muted = muted;
      m_volume = volume;
      m_rate = rate;
      m_audioTrack = audioTrack;
      m_subtitleTrack = subtitleTrack;
      Load();
      return;
    }
    if (!m_session)
      return;
    auto *player = m_session->player;
    if (paused != m_paused) {
      m_paused = paused;
      if (paused) {
        if (!m_pauseOnFrame)
          libvlc_media_player_set_pause(player, 1);
      } else {
        m_pauseOnFrame = false;
        ApplyAudio();
        if (m_ended) { // stopped at the end: play again from the start
          m_ended = false;
          libvlc_media_player_stop(player);
        }
        libvlc_media_player_play(player);
      }
    }
    if (muted != m_muted || volume != m_volume) {
      m_muted = muted;
      m_volume = volume;
      ApplyAudio();
    }
    if (rate != m_rate) {
      m_rate = rate;
      libvlc_media_player_set_rate(player, m_rate);
    }
    if (audioTrack != m_audioTrack) {
      m_audioTrack = audioTrack;
      SelectAudioTrack();
    }
    if (subtitleTrack != m_subtitleTrack) {
      m_subtitleTrack = subtitleTrack;
      SelectSubtitleTrack();
    }
  }

  void HandleSeekCommand(double time) noexcept override {
    if (!m_session)
      return;
    auto *player = m_session->player;
    if (m_ended) { // the player stopped at the end; seeking starts it again
      m_ended = false;
      libvlc_media_player_stop(player);
      libvlc_media_player_play(player);
    }
    const libvlc_time_t target = libvlc_time_t(time * 1000);
    m_seekTarget = time;
    libvlc_media_player_set_time(player, target); // precise, not keyframe (VLC's default)
    if (m_paused) {
      // A paused player shows nothing new after a seek: play up to the first frame from there. The seek is queued
      // before the resume, so that frame is from the new position.
      m_seekTargetMs = -1;
      m_seekReached = true;
      StepToFrame();
    } else {
      m_seekTargetMs = target;
      m_seekReached = false;
    }
  }

 private:
  void Load() {
    ReleaseSession();
    const uint64_t generation = ++m_generation;
    m_started = m_loaded = m_ended = m_pauseOnFrame = m_seekReached = false;
    m_seekTargetMs = -1;
    if (m_source.empty())
      return;
    if (!Instance())
      return Fail(generation, "Cannot start libVLC: " + LastError("libvlc_new failed"));

    auto session = std::make_shared<Session>();
    session->view = get_weak();
    session->generation = generation;
    session->dispatcher = m_dispatcher;
    try {
      session->renderer = std::make_shared<VlcRenderer>(m_compositor);
    } catch (const winrt::hresult_error &e) {
      return Fail(generation, "Cannot create the D3D11 video output: " + winrt::to_string(e.message()));
    }

    const bool url = m_source.find("://") != std::string::npos;
    libvlc_media_t *media = url ? libvlc_media_new_location(Instance(), m_source.c_str())
                                : libvlc_media_new_path(Instance(), m_source.c_str());
    if (!media)
      return Fail(generation, "Cannot open " + m_source);
    if (url && !m_tlsVerify)
      AllowUnverified(UrlHost(m_source));
    // A muted cached source (a preview clip) has no audio at all: VLC otherwise starts an audio output and holds the
    // first picture until the audio clock runs. Unmuting it later stays silent. (No download on Windows.)
    // Small buffers make it start sooner, which suits these small clips (not long or 4K playback, see Instance()).
    if (m_cache && m_muted) {
      libvlc_media_add_option(media, ":no-audio");
      libvlc_media_add_option(media, ":network-caching=300");
      libvlc_media_add_option(media, ":file-caching=300");
    }
    if (m_loop)
      libvlc_media_add_option(media, ":input-repeat=65535");
    if (!m_demux.empty())
      libvlc_media_add_option(media, (":demux=" + m_demux).c_str());
    // D3D11VA decodes into the output's pictures, on the renderer's device.
    libvlc_media_add_option(media, m_hardware ? ":avcodec-hw=d3d11va" : ":avcodec-hw=none");
    session->player = libvlc_media_player_new_from_media(media);
    libvlc_media_release(media);
    if (!session->player)
      return Fail(generation, "Cannot create the VLC player: " + LastError("libvlc_media_player_new failed"));
    if (!session->renderer->Attach(session->player))
      return Fail(generation, "The d3d11_host video output module is missing from libVLC's plugins");

    auto *events = libvlc_media_player_event_manager(session->player);
    for (const auto type : kPlayerEvents)
      libvlc_event_attach(events, type, OnEvent, session.get());

    // The video shows from its first frame on: until then the view stays transparent (no black flash over
    // whatever is under it, such as a cover image).
    session->renderer->SetFrameCallback([s = session.get()] { s->Post([](VlcVideoView &view) { view.OnFrame(); }); });
    session->renderer->NotifyNextFrame();
    m_content.IsVisible(false);
    if (m_size[0])
      session->renderer->Resize(m_size[0], m_size[1]);

    auto brush = m_compositor.CreateSurfaceBrush(session->renderer->Surface());
    // The surface follows VLC's output size, which is the view's; Fill only matters while a resize is in flight.
    brush.Stretch(Composition::CompositionStretch::Fill);
    m_content.Brush(brush);

    m_session = std::move(session);
    ApplyAudio();
    libvlc_media_player_set_rate(m_session->player, m_rate);
    // Starting paused: play up to the first frame and pause there (a player paused from the start shows nothing).
    if (m_paused) {
      StepToFrame();
    } else if (libvlc_media_player_play(m_session->player) != 0) {
      return Fail(generation, "Cannot play " + m_source + ": " + LastError("libvlc_media_player_play failed"));
    }
  }

  // Plays up to the next frame and pauses there (OnFrame), muted meanwhile.
  void StepToFrame() {
    m_pauseOnFrame = true;
    ApplyAudio();
    m_session->renderer->NotifyNextFrame();
    libvlc_media_player_play(m_session->player);
  }

  void StepDone() {
    if (!m_pauseOnFrame || !m_session)
      return;
    m_pauseOnFrame = false;
    libvlc_media_player_set_pause(m_session->player, 1);
    ApplyAudio();
  }

  void ApplyAudio() {
    if (!m_session)
      return;
    libvlc_audio_set_mute(m_session->player, m_muted || m_pauseOnFrame);
    libvlc_audio_set_volume(m_session->player, int(m_volume * 100 + 0.5f));
  }

  // A track description list's ids (without libVLC's "Disable" entry) and names, in the order onLoad reports them.
  static std::vector<std::pair<int, std::string>> Tracks(libvlc_track_description_t *list) {
    std::vector<std::pair<int, std::string>> tracks;
    for (auto *track = list; track; track = track->p_next) {
      if (track->i_id >= 0)
        tracks.emplace_back(track->i_id, track->psz_name ? track->psz_name : "");
    }
    if (list)
      libvlc_track_description_list_release(list);
    return tracks;
  }

  std::vector<std::pair<int, std::string>> AudioTracks() const {
    return Tracks(libvlc_audio_get_track_description(m_session->player));
  }

  std::vector<std::pair<int, std::string>> SubtitleTracks() const {
    return Tracks(libvlc_video_get_spu_description(m_session->player));
  }

  // audioTrack is a position in the audio track list (the indices onLoad reports); -1 keeps VLC's choice.
  void SelectAudioTrack() {
    if (!m_session || m_audioTrack < 0)
      return;
    const auto tracks = AudioTracks();
    if (size_t(m_audioTrack) < tracks.size() &&
        libvlc_audio_get_track(m_session->player) != tracks[size_t(m_audioTrack)].first)
      libvlc_audio_set_track(m_session->player, tracks[size_t(m_audioTrack)].first);
  }

  // subtitleTrack is a position in the subtitle track list; -1 keeps VLC's choice, -2 shows none.
  void SelectSubtitleTrack() {
    if (!m_session || m_subtitleTrack == -1)
      return;
    int id = -1;
    if (m_subtitleTrack >= 0) {
      const auto tracks = SubtitleTracks();
      if (size_t(m_subtitleTrack) >= tracks.size())
        return;
      id = tracks[size_t(m_subtitleTrack)].first;
    }
    if (libvlc_video_get_spu(m_session->player) != id)
      libvlc_video_set_spu(m_session->player, id);
  }

  // onLoad, once playback has started and the video track (if any) is known.
  void TryLoad() {
    if (m_loaded || !m_started || !m_session)
      return;
    auto *player = m_session->player;
    const bool hasVideo = libvlc_video_get_track_count(player) > 0;
    const int videoId = libvlc_video_get_track(player);

    // Codecs, sizes, languages, channels and rates are on the media's tracks, matched by id.
    libvlc_media_track_t **mediaTracks = nullptr;
    libvlc_media_t *media = libvlc_media_player_get_media(player);
    const unsigned count = media ? libvlc_media_tracks_get(media, &mediaTracks) : 0;
    auto find = [&](int id) -> const libvlc_media_track_t * {
      for (unsigned i = 0; i < count; ++i)
        if (mediaTracks[i]->i_id == id)
          return mediaTracks[i];
      return nullptr;
    };

    Codegen::VlcVideoViewEventEmitter::OnLoad e;
    unsigned width = 0, height = 0;
    if (hasVideo && libvlc_video_get_size(player, 0, &width, &height) != 0)
      width = height = 0;
    const libvlc_media_track_t *video = hasVideo ? find(videoId) : nullptr;
    if (video && video->i_type == libvlc_track_video) {
      if (!width && video->video) {
        width = video->video->i_width;
        height = video->video->i_height;
      }
      e.codec = CodecName(libvlc_track_video, video->i_codec);
    }
    bool ready = !hasVideo || width > 0;
    const auto audios = AudioTracks();
    if (ready && !hasVideo && audios.empty())
      ready = false;
    if (ready) {
      e.width = int(width);
      e.height = int(height);
      e.audioTrack = -1;
      const int current = libvlc_audio_get_track(player);
      for (size_t i = 0; i < audios.size(); ++i) {
        const libvlc_media_track_t *audio = find(audios[i].first);
        Codegen::VlcVideoViewSpec_onLoad2 t;
        t.index = int(i);
        t.language = audio && audio->psz_language ? audio->psz_language : "";
        t.title = !audios[i].second.empty() ? audios[i].second
                                            : (audio && audio->psz_description ? audio->psz_description : "");
        if (audio) {
          t.codec = CodecName(libvlc_track_audio, audio->i_codec);
          if (audio->i_type == libvlc_track_audio && audio->audio) {
            t.channels = int(audio->audio->i_channels);
            t.sampleRate = int(audio->audio->i_rate);
          }
        }
        if (audios[i].first == current)
          e.audioTrack = int(i);
        e.audioTracks.push_back(std::move(t));
      }

      SelectSubtitleTrack(); // before onLoad reports which one shows
      e.subtitleTrack = -1;
      const int currentSubtitle = libvlc_video_get_spu(player);
      const auto subtitles = SubtitleTracks();
      for (size_t i = 0; i < subtitles.size(); ++i) {
        const libvlc_media_track_t *subtitle = find(subtitles[i].first);
        Codegen::VlcVideoViewSpec_onLoad3 t;
        t.index = int(i);
        t.language = subtitle && subtitle->psz_language ? subtitle->psz_language : "";
        t.title = !subtitles[i].second.empty()
                      ? subtitles[i].second
                      : (subtitle && subtitle->psz_description ? subtitle->psz_description : "");
        if (subtitle)
          t.codec = CodecName(libvlc_track_text, subtitle->i_codec);
        if (subtitles[i].first == currentSubtitle)
          e.subtitleTrack = int(i);
        e.subtitleTracks.push_back(std::move(t));
      }
    }
    if (mediaTracks)
      libvlc_media_tracks_release(mediaTracks, count);
    if (media)
      libvlc_media_release(media);
    if (!ready)
      return; // the next track event tells

    e.hasAudio = !e.audioTracks.empty();
    const libvlc_time_t length = libvlc_media_player_get_length(player);
    e.duration = length > 0 ? double(length) / 1000 : 0;
    // libVLC does not say which decoder it picked; with hardware decoding allowed, D3D11VA is used when the GPU
    // supports the codec.
    e.hwDecoding = m_hardware && hasVideo;
    m_loaded = true;
    if (m_audioTrack >= 0 && m_audioTrack != e.audioTrack)
      SelectAudioTrack();
    if (EventEmitter())
      EventEmitter()->onLoad(std::move(e));
  }

  void OnStarted() {
    if (!m_started) {
      m_started = true;
      ApplyAudio();
    }
    TryLoad();
  }

  void OnTime(libvlc_time_t time) {
    if (!m_session)
      return;
    if (m_seekTargetMs >= 0 && std::abs(time - m_seekTargetMs) < 1500) {
      // there: onSeek with the next frame (OnFrame)
      m_seekTargetMs = -1;
      m_seekReached = true;
      m_session->renderer->NotifyNextFrame();
    }
    // Stepping with no video: no frame to wait for.
    if (m_pauseOnFrame && libvlc_video_get_track_count(m_session->player) <= 0)
      StepDone();
    const ULONGLONG now = GetTickCount64();
    if (!m_pauseOnFrame && now - m_lastProgress >= kProgressPeriodMs && EventEmitter()) {
      m_lastProgress = now;
      const libvlc_time_t length = libvlc_media_player_get_length(m_session->player);
      EventEmitter()->onProgress({double(time) / 1000, length > 0 ? double(length) / 1000 : 0});
    }
  }

  void OnEnded() {
    m_ended = true;
    if (EventEmitter())
      EventEmitter()->onEnd({});
  }

  // A frame VLC presented after NotifyNextFrame is in the surface.
  void OnFrame() {
    m_content.IsVisible(true);
    StepDone();
    if (m_seekReached) {
      m_seekReached = false;
      const libvlc_time_t time = m_session ? libvlc_media_player_get_time(m_session->player) : -1;
      if (EventEmitter())
        EventEmitter()->onSeek({time >= 0 ? double(time) / 1000 : m_seekTarget});
    }
  }

  void EmitError(std::string message) {
    if (m_errored)
      return;
    m_errored = true;
    if (EventEmitter())
      EventEmitter()->onError({std::move(message)});
  }

  void Fail(uint64_t generation, std::string message) {
    ReleaseSession();
    m_dispatcher.Post([weak = get_weak(), generation, message = std::move(message)] {
      if (auto self = weak.get(); self && self->m_generation == generation && self->EventEmitter())
        self->EventEmitter()->onError({message});
    });
  }

  // Stopping joins VLC's threads (demux, decoders, output), which can take a while on a network stream: off the
  // UI thread. The session keeps the renderer alive until the player is gone.
  void ReleaseSession() {
    m_errored = false;
    if (m_content) {
      try {
        m_content.Brush(nullptr);
      } catch (const winrt::hresult_error &) {
        // the visual is already closed (view destroyed)
      }
    }
    if (auto session = std::move(m_session))
      std::thread([session = std::move(session)]() mutable { session.reset(); }).detach();
  }

  void Shutdown() noexcept {
    ++m_generation;
    ReleaseSession();
  }

  // VLC's events: on VLC's threads, so they post to the view.
  static void OnEvent(const libvlc_event_t *event, void *opaque) {
    auto &session = *static_cast<Session *>(opaque);
    switch (event->type) {
    case libvlc_MediaPlayerPlaying:
    case libvlc_MediaPlayerPaused:
      session.Post([](VlcVideoView &view) { view.OnStarted(); });
      break;
    case libvlc_MediaPlayerEndReached:
      session.Post([](VlcVideoView &view) { view.OnEnded(); });
      break;
    case libvlc_MediaPlayerEncounteredError:
      session.Post([](VlcVideoView &view) {
        view.EmitError("Cannot play " + view.m_source + ": " + LastError("VLC reported an error"));
      });
      break;
    case libvlc_MediaPlayerTimeChanged:
      session.Post([time = event->u.media_player_time_changed.new_time](VlcVideoView &view) { view.OnTime(time); });
      break;
    default: // tracks, length, video output
      session.Post([](VlcVideoView &view) { view.TryLoad(); });
      break;
    }
  }

  friend struct Session;

  Composition::Compositor m_compositor{nullptr};
  Composition::SpriteVisual m_content{nullptr};
  std::shared_ptr<Session> m_session;
  RN::IReactDispatcher m_dispatcher{nullptr};
  RN::ComponentView::Destroying_revoker m_destroyingRevoker;
  unsigned m_size[2]{};
  bool m_propsSet = false;
  std::string m_source;
  bool m_hardware = true;
  bool m_loop = false;
  bool m_cache = false;
  bool m_tlsVerify = true;
  std::string m_demux;
  bool m_paused = false;
  bool m_muted = false;
  float m_volume = 1.0f;
  float m_rate = 1.0f;
  int m_audioTrack = -1;
  int m_subtitleTrack = -1;
  uint64_t m_generation = 0;
  bool m_started = false; // the player reached Playing (or Paused)
  bool m_loaded = false; // onLoad sent
  bool m_ended = false; // stopped at the end of the media
  bool m_errored = false;
  bool m_pauseOnFrame = false; // paused: playing up to the next frame, to pause there
  libvlc_time_t m_seekTargetMs = -1; // set_time sent, waiting for the time to get there
  bool m_seekReached = false; // there: onSeek with the next frame
  double m_seekTarget = 0;
  ULONGLONG m_lastProgress = 0;
};

template <typename F>
void Session::Post(F &&fn) {
  dispatcher.Post([view = view, generation = generation, fn = std::forward<F>(fn)] {
    if (auto self = view.get(); self && self->m_generation == generation)
      fn(*self);
  });
}

} // namespace

void RegisterVlcVideoViewNativeComponent(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
  Codegen::RegisterVlcVideoViewNativeComponent<VlcVideoView>(packageBuilder, {});
}
