#include "pch.h"

#include "VlcVideoView.h"

#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Windows.UI.h>
#include <winrt/Microsoft.UI.Composition.interop.h>

#include <cerrno>
#include <cstdarg>
#include <cstdio>
#include <mutex>
#include <thread>

#include "codegen/react/components/VlcSpec/VlcVideoView.g.h"
#include "VlcRenderer.h"

namespace Codegen = ReactNativeVlcCodegen;
namespace RN = winrt::Microsoft::ReactNative;
namespace Composition = winrt::Microsoft::UI::Composition;

namespace {

using namespace ReactNativeVlc;

constexpr libvlc_time_t kProgressPeriodUs = 250'000;

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

// One libVLC instance for the process (plugins are loaded once), created on first use.
libvlc_instance_t *Instance() {
  static libvlc_instance_t *instance = [] {
    const char *args[] = {
        "--no-video-title-show",
        "--no-osd",
        "--no-snapshot-preview",
        // VLC 4 remembers and restores where each media was left: playback here starts where the app says.
        "--no-media-library",
        "--restore-playback-pos=0",
        // Start sooner than with the default 1 s buffers; Cove streams from the LAN.
        "--network-caching=300",
        "--file-caching=300",
    };
    libvlc_instance_t *vlc = libvlc_new(int(std::size(args)), args);
    if (!vlc) // an option this build does not know
      vlc = libvlc_new(0, nullptr);
    if (vlc)
      libvlc_log_set(vlc, Log, nullptr);
    return vlc;
  }();
  return instance;
}

std::string LastError(const char *fallback) {
  std::lock_guard lock(g_errorLock);
  return g_lastError.empty() ? fallback : g_lastError;
}

// "H264 - MPEG-4 AVC (part 10)" -> "H264".
std::string CodecName(libvlc_track_type_t type, uint32_t codec) {
  std::string name = libvlc_media_get_codec_description(type, codec);
  if (const auto dash = name.find(" - "); dash != std::string::npos)
    name.resize(dash);
  return name;
}

struct VlcVideoView;

// One playback: the player, the renderer it draws through, and the view it reports to. VLC's callbacks get the
// session and post to the view on the UI thread, where they are dropped once the view moved on (generation).
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
      libvlc_media_player_unwatch_time(player);
      libvlc_media_player_release(player); // stops, joins VLC's threads and cleans up the renderer
    }
  }
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
    const int audioTrack = newProps->audioTrack;

    const std::string source = newProps->source.value_or("");
    const bool hardware = newProps->hardwareDecoding;
    const bool loop = newProps->loop.value_or(false);
    if (source != m_source || hardware != m_hardware || loop != m_loop || !m_propsSet) {
      m_propsSet = true;
      m_source = source;
      m_hardware = hardware;
      m_loop = loop;
      m_paused = paused;
      m_muted = muted;
      m_volume = volume;
      m_audioTrack = audioTrack;
      Load();
      return;
    }
    if (!m_session)
      return;
    auto *player = m_session->player;
    if (paused != m_paused) {
      m_paused = paused;
      if (!paused && m_ended) { // stopped at the end: play again from the start
        m_ended = false;
        libvlc_media_player_play(player);
      } else {
        libvlc_media_player_set_pause(player, paused);
      }
    }
    if (muted != m_muted || volume != m_volume) {
      m_muted = muted;
      m_volume = volume;
      ApplyAudio();
    }
    if (audioTrack != m_audioTrack) {
      m_audioTrack = audioTrack;
      SelectAudioTrack();
    }
  }

  void HandleSeekCommand(double time) noexcept override {
    if (!m_session)
      return;
    auto *player = m_session->player;
    if (m_ended) { // the player stopped at the end; seeking starts it again
      m_ended = false;
      libvlc_media_player_play(player);
      m_started = false; // OnState pauses on the first frame again
    }
    m_seekTarget = time;
    m_seekPending = true;
    m_seekDone = false;
    libvlc_media_player_set_time(player, libvlc_time_t(time * 1e6), false); // precise, not keyframe
  }

 private:
  void Load() {
    ReleaseSession();
    const uint64_t generation = ++m_generation;
    m_started = m_loaded = m_ended = m_seekPending = m_seekDone = false;
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
    libvlc_media_t *media = url ? libvlc_media_new_location(m_source.c_str()) : libvlc_media_new_path(m_source.c_str());
    if (!media)
      return Fail(generation, "Cannot open " + m_source);
    if (m_loop)
      libvlc_media_add_option(media, ":input-repeat=65535");
    if (!m_hardware) {
      libvlc_media_add_option(media, ":avcodec-hw=none");
      libvlc_media_add_option(media, ":dec-dev=none");
    }
    session->player = libvlc_media_player_new_from_media(Instance(), media, PlayerCallbacks(), session.get());
    libvlc_media_release(media);
    if (!session->player)
      return Fail(generation, "Cannot create the VLC player: " + LastError("libvlc_media_player_new failed"));

    session->renderer->Attach(session->player);
    // The video shows from its first frame on: until then the view stays transparent (no black flash over
    // whatever is under it, such as a cover image).
    session->renderer->SetFrameCallback([s = session.get()] { s->Post([](VlcVideoView &view) { view.OnFrame(); }); });
    session->renderer->NotifyNextFrame();
    m_content.IsVisible(false);
    if (m_size[0])
      session->renderer->Resize(m_size[0], m_size[1]);
    libvlc_media_player_watch_time(session->player, kProgressPeriodUs, TimeCallbacks(), session.get());

    auto brush = m_compositor.CreateSurfaceBrush(session->renderer->Surface());
    // The surface follows VLC's output size, which is the view's; Fill only matters while a resize is in flight.
    brush.Stretch(Composition::CompositionStretch::Fill);
    m_content.Brush(brush);

    m_session = std::move(session);
    ApplyAudio();
    // Starting paused: OnState shows the first frame and pauses there (a player paused from the start shows nothing).
    if (libvlc_media_player_play(m_session->player) != 0)
      return Fail(generation, "Cannot play " + m_source + ": " + LastError("libvlc_media_player_play failed"));
  }

  // Pauses on the next frame and shows it: a paused player displays nothing after starting or seeking otherwise.
  void ShowFrame() {
    m_frameRetry = true;
    libvlc_media_player_next_frame(m_session->player);
  }

  void OnNextFrameStatus(int status) {
    // -EAGAIN: the call only paused the player; the next one steps.
    if (status == -EAGAIN && m_frameRetry && m_paused && m_session) {
      m_frameRetry = false;
      libvlc_media_player_next_frame(m_session->player);
    }
  }

  void ApplyAudio() {
    libvlc_audio_set_mute(m_session->player, m_muted);
    libvlc_audio_set_volume(m_session->player, int(m_volume * 100 + 0.5f));
  }

  // audioTrack is a position in the audio track list (the indices onLoad reports); -1 keeps VLC's choice.
  void SelectAudioTrack() {
    if (!m_session || m_audioTrack < 0)
      return;
    if (auto *list = libvlc_media_player_get_tracklist(m_session->player, libvlc_track_audio, false)) {
      if (size_t(m_audioTrack) < libvlc_media_tracklist_count(list)) {
        auto *track = libvlc_media_tracklist_at(list, size_t(m_audioTrack));
        if (!track->selected)
          libvlc_media_player_select_track(m_session->player, track);
      }
      libvlc_media_tracklist_delete(list);
    }
  }

  // onLoad, once playback has started and the video track (if any) is known.
  void TryLoad() {
    if (m_loaded || !m_started || !m_session)
      return;
    auto *player = m_session->player;
    Codegen::VlcVideoViewEventEmitter::OnLoad e;
    bool hasVideo = false, videoKnown = false;
    if (auto *list = libvlc_media_player_get_tracklist(player, libvlc_track_video, false)) {
      for (size_t i = 0; i < libvlc_media_tracklist_count(list); ++i) {
        auto *track = libvlc_media_tracklist_at(list, i);
        hasVideo = true;
        if (track->selected && track->u.video && track->u.video->i_width) {
          videoKnown = true;
          e.width = int(track->u.video->i_width);
          e.height = int(track->u.video->i_height);
          e.codec = CodecName(libvlc_track_video, track->i_codec);
        }
      }
      libvlc_media_tracklist_delete(list);
    }
    if (hasVideo && !videoKnown)
      return; // the next track event tells
    e.audioTrack = -1;
    if (auto *list = libvlc_media_player_get_tracklist(player, libvlc_track_audio, false)) {
      for (size_t i = 0; i < libvlc_media_tracklist_count(list); ++i) {
        auto *track = libvlc_media_tracklist_at(list, i);
        Codegen::VlcVideoViewSpec_onLoad2 t;
        t.index = int(i);
        t.language = track->psz_language ? track->psz_language : "";
        t.title = track->psz_description ? track->psz_description : (track->psz_name ? track->psz_name : "");
        t.codec = CodecName(libvlc_track_audio, track->i_codec);
        if (track->u.audio) {
          t.channels = int(track->u.audio->i_channels);
          t.sampleRate = int(track->u.audio->i_rate);
        }
        if (track->selected)
          e.audioTrack = int(i);
        e.audioTracks.push_back(std::move(t));
      }
      libvlc_media_tracklist_delete(list);
    }
    e.hasAudio = !e.audioTracks.empty();
    if (!hasVideo && !e.hasAudio)
      return;
    const libvlc_time_t length = libvlc_media_player_get_length(player);
    e.duration = length > 0 ? double(length) / 1e6 : 0;
    // libVLC does not say which decoder it picked; with hardware decoding allowed, D3D11VA is used when the GPU
    // supports the codec.
    e.hwDecoding = m_hardware && hasVideo;
    m_loaded = true;
    if (m_audioTrack >= 0 && m_audioTrack != e.audioTrack)
      SelectAudioTrack();
    if (EventEmitter())
      EventEmitter()->onLoad(std::move(e));
  }

  void OnState(libvlc_state_t state) {
    if (state == libvlc_Playing || state == libvlc_Paused) {
      if (!m_started) {
        m_started = true;
        ApplyAudio(); // the audio output exists now
        if (m_paused)
          ShowFrame();
      }
      TryLoad();
    } else if (state == libvlc_Error) {
      EmitError("Cannot play " + m_source + ": " + LastError("VLC reported an error"));
    }
  }

  void OnStopping(libvlc_stopping_reason_t reason) {
    if (reason == libvlc_stopping_reason_eos) {
      m_ended = true;
      if (EventEmitter())
        EventEmitter()->onEnd({});
    } else if (reason == libvlc_stopping_reason_error) {
      EmitError("Cannot play " + m_source + ": " + LastError("VLC stopped on an error"));
    }
  }

  void OnProgress(libvlc_time_t time, libvlc_time_t length) {
    if (time >= 0 && EventEmitter())
      EventEmitter()->onProgress({double(time) / 1e6, length > 0 ? double(length) / 1e6 : 0});
  }

  void OnSeekDone() {
    if (!m_seekPending)
      return;
    m_seekPending = false;
    if (!m_session)
      return;
    // onSeek once a frame from the new position is on screen (OnFrame).
    m_seekDone = true;
    m_session->renderer->NotifyNextFrame();
    if (m_paused)
      ShowFrame();
  }

  // A frame VLC presented after NotifyNextFrame is in the surface.
  void OnFrame() {
    m_content.IsVisible(true);
    if (m_seekDone) {
      m_seekDone = false;
      const libvlc_time_t time = m_session ? libvlc_media_player_get_time(m_session->player) : -1;
      if (EventEmitter())
        EventEmitter()->onSeek({time >= 0 ? double(time) / 1e6 : m_seekTarget});
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
    if (auto session = std::move(m_session)) {
      libvlc_media_player_stop_async(session->player);
      std::thread([session = std::move(session)]() mutable { session.reset(); }).detach();
    }
  }

  void Shutdown() noexcept {
    ++m_generation;
    ReleaseSession();
  }

  // VLC's callbacks: on VLC's threads, with the player locked (no player calls here), so they post to the view.
  static Session &S(void *opaque) { return *static_cast<Session *>(opaque); }

  // Must outlive the players: static.
  static const libvlc_media_player_cbs *PlayerCallbacks() {
    static const libvlc_media_player_cbs callbacks = [] {
      libvlc_media_player_cbs cbs{};
      cbs.version = 0;
      cbs.on_state_changed = [](void *opaque, libvlc_state_t state) {
        S(opaque).Post([state](VlcVideoView &view) { view.OnState(state); });
      };
      cbs.on_media_stopping = [](void *opaque, libvlc_media_t *, libvlc_stopping_reason_t reason) {
        S(opaque).Post([reason](VlcVideoView &view) { view.OnStopping(reason); });
      };
      cbs.on_track_selection_changed = [](void *opaque, libvlc_track_type_t, const char *, const char *) {
        S(opaque).Post([](VlcVideoView &view) { view.TryLoad(); });
      };
      cbs.on_track_list_changed = [](void *opaque, libvlc_list_action_t, libvlc_track_type_t, const char *) {
        S(opaque).Post([](VlcVideoView &view) { view.TryLoad(); });
      };
      cbs.on_length_changed = [](void *opaque, libvlc_time_t) {
        S(opaque).Post([](VlcVideoView &view) { view.TryLoad(); });
      };
      cbs.on_next_frame_status = [](void *opaque, int status) {
        S(opaque).Post([status](VlcVideoView &view) { view.OnNextFrameStatus(status); });
      };
      return cbs;
    }();
    return &callbacks;
  }

  static const libvlc_media_player_watch_time_cbs *TimeCallbacks() {
    static const libvlc_media_player_watch_time_cbs callbacks = [] {
      libvlc_media_player_watch_time_cbs cbs{};
      cbs.version = 0;
      cbs.on_update = [](void *opaque, const libvlc_media_player_time_point_t *point) {
        S(opaque).Post([time = point->ts_us, length = point->length_us](VlcVideoView &view) {
          view.OnProgress(time, length);
        });
      };
      cbs.on_paused = [](void *, libvlc_time_t) {};
      cbs.on_seek = [](void *opaque, const libvlc_media_player_time_point_t *point) {
        if (!point) // the seek is done
          S(opaque).Post([](VlcVideoView &view) { view.OnSeekDone(); });
      };
      return cbs;
    }();
    return &callbacks;
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
  bool m_paused = false;
  bool m_muted = false;
  float m_volume = 1.0f;
  int m_audioTrack = -1;
  uint64_t m_generation = 0;
  bool m_started = false; // the player reached Playing (or Paused)
  bool m_loaded = false; // onLoad sent
  bool m_ended = false; // stopped at the end of the media
  bool m_errored = false;
  bool m_seekPending = false; // set_time sent, VLC has not finished seeking
  bool m_seekDone = false; // seeked, waiting for the first frame from there
  bool m_frameRetry = false;
  double m_seekTarget = 0;
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
