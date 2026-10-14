#include "pch.h"

#include "MpvVideoView.h"

#include <d3d11_4.h>

#include <winrt/Microsoft.Graphics.DirectX.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Composition.interop.h>
#include <winrt/Windows.UI.h>

#include <mpv/d3d11_composition.h>

#include <algorithm>
#include <atomic>
#include <mutex>
#include <thread>

#include "codegen/react/components/MpvSpec/MpvVideoView.g.h"
#include "HttpCache.h"
#include "MpvPlayer.h"
#include "Platform.h"
#include "WindowsPlatform.h"

namespace Codegen = ReactNativeMpvCodegen;
namespace RN = winrt::Microsoft::ReactNative;
namespace Composition = winrt::Microsoft::UI::Composition;
namespace Dx = winrt::Microsoft::Graphics::DirectX;

namespace {

using namespace ReactNativeMpv;

// One player's D3D11 device: mpv renders and decodes (D3D11VA) on it (d3d11-composition-device), and the player's
// composition surface lives on it (a CompositionGraphicsDevice made from it), so each frame is one copy on the GPU.
// One per player, never shared: mpv sets up its pipeline on the immediate context call by call, and two players on
// one context (a hover preview under the player, say) would draw with each other's state.
struct VideoDevice {
  winrt::com_ptr<ID3D11Device> device;
  winrt::com_ptr<ID3D11DeviceContext1> context;
  Composition::CompositionGraphicsDevice graphics{nullptr};

  // On the UI thread. Throws winrt::hresult_error.
  static std::shared_ptr<VideoDevice> Create(const Composition::Compositor &compositor) {
    auto device = std::make_shared<VideoDevice>();
    // BGRA support for composition, video support for D3D11VA.
    const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_12_1, D3D_FEATURE_LEVEL_12_0, D3D_FEATURE_LEVEL_11_1,
                                        D3D_FEATURE_LEVEL_11_0};
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
                                   D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, levels,
                                   ARRAYSIZE(levels), D3D11_SDK_VERSION, device->device.put(), nullptr, nullptr);
    if (FAILED(hr)) // no hardware decoding (mpv decodes in software), or no GPU at all
      hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels,
                             ARRAYSIZE(levels), D3D11_SDK_VERSION, device->device.put(), nullptr, nullptr);
    winrt::check_hresult(hr);
    winrt::com_ptr<ID3D11DeviceContext> context;
    device->device->GetImmediateContext(context.put());
    device->context = context.as<ID3D11DeviceContext1>();
    // mpv's threads (VO, decoder) and composition (BeginDraw/EndDraw) all use the immediate context.
    device->context.as<ID3D11Multithread>()->SetMultithreadProtected(TRUE);
    winrt::check_hresult(compositor.as<Composition::ICompositorInterop>()->CreateGraphicsDevice(device->device.get(),
                                                                                                &device->graphics));
    return device;
  }
};

// A player's composition surface (BGRA, sized to the view in pixels: mpv renders at that size, letterboxed): black
// until mpv's first frame, then each frame as it arrives on mpv's VO thread.
class VideoSurface {
 public:
  // On the UI thread, before the player starts. Throws winrt::hresult_error.
  VideoSurface(std::shared_ptr<VideoDevice> device, uint32_t width, uint32_t height) : m_device(std::move(device)) {
    m_surface = m_device->graphics.CreateDrawingSurface2({16, 16}, Dx::DirectXPixelFormat::B8G8R8A8UIntNormalized,
                                                         Dx::DirectXAlphaMode::Ignore);
    m_interop = m_surface.as<Composition::ICompositionDrawingSurfaceInterop>();
    Clear(width, height);
  }

  const Composition::CompositionDrawingSurface &Surface() const noexcept { return m_surface; }
  ID3D11Device *Device() const noexcept { return m_device->device.get(); }

  // A frame mpv rendered (on the same device): copied into the surface, which takes its size.
  void Draw(ID3D11Texture2D *frame) noexcept {
    D3D11_TEXTURE2D_DESC desc{};
    frame->GetDesc(&desc);
    std::lock_guard lock(m_mutex);
    if (!Size(desc.Width, desc.Height))
      return;
    winrt::com_ptr<ID3D11Texture2D> target;
    POINT offset{};
    if (FAILED(m_interop->BeginDraw(nullptr, IID_PPV_ARGS(target.put()), &offset)))
      return;
    const D3D11_BOX box{0, 0, 0, desc.Width, desc.Height, 1};
    m_device->context->CopySubresourceRegion(target.get(), 0, UINT(offset.x), UINT(offset.y), 0, frame, 0, &box);
    m_interop->EndDraw();
  }

  // Black at a size (no frame yet).
  void Clear(uint32_t width, uint32_t height) noexcept {
    std::lock_guard lock(m_mutex);
    if (!Size(width, height))
      return;
    winrt::com_ptr<ID3D11Texture2D> target;
    POINT offset{};
    if (FAILED(m_interop->BeginDraw(nullptr, IID_PPV_ARGS(target.put()), &offset)))
      return;
    winrt::com_ptr<ID3D11RenderTargetView> view;
    if (SUCCEEDED(m_device->device->CreateRenderTargetView(target.get(), nullptr, view.put()))) {
      const float black[4] = {0, 0, 0, 1};
      // The surface may be a region of a shared atlas: only that region.
      const D3D11_RECT rect{offset.x, offset.y, LONG(offset.x + m_width), LONG(offset.y + m_height)};
      m_device->context->ClearView(view.get(), black, &rect, 1);
    }
    m_interop->EndDraw();
  }

 private:
  bool Size(uint32_t width, uint32_t height) noexcept { // m_mutex held
    width = std::clamp<uint32_t>(width, 1, 16384);
    height = std::clamp<uint32_t>(height, 1, 16384);
    if (width == m_width && height == m_height)
      return true;
    if (FAILED(m_interop->Resize({LONG(width), LONG(height)})))
      return false;
    m_width = width;
    m_height = height;
    return true;
  }

  std::shared_ptr<VideoDevice> m_device;
  Composition::CompositionDrawingSurface m_surface{nullptr};
  winrt::com_ptr<Composition::ICompositionDrawingSurfaceInterop> m_interop;
  std::mutex m_mutex;
  uint32_t m_width = 0, m_height = 0;
};

// What one player's mpv hands its frames to (mpv_d3d11_composition_hook): the player's surface (and through it its
// device), while the player is the view's current one. Kept alive until that mpv is destroyed.
struct FrameHook {
  explicit FrameHook(std::shared_ptr<VideoSurface> s) : surface(std::move(s)) {
    hook.present = [](void *opaque, void *texture) {
      auto *self = static_cast<FrameHook *>(opaque);
      if (self->active.load(std::memory_order_acquire))
        self->surface->Draw(static_cast<ID3D11Texture2D *>(texture));
    };
    hook.opaque = this;
  }

  mpv_d3d11_composition_hook hook{};
  std::shared_ptr<VideoSurface> surface;
  std::atomic<bool> active{true};
};

// Destroys a player off the UI thread (mpv joins its threads and closes its streams), with its hook, surface and
// device kept alive until then. The view has moved on: it shows a newer player's surface, or black.
void Dispose(std::unique_ptr<MpvPlayer> player, std::shared_ptr<FrameHook> hook) {
  if (!player)
    return;
  if (hook)
    hook->active = false;
  std::thread([player = std::move(player), hook = std::move(hook)]() mutable {
    SetThreadName("mpv dispose");
    player.reset();
    hook.reset();
  }).detach();
}

// <MpvVideoView> on Windows: a SpriteVisual showing its current player's composition surface, into which that
// MpvPlayer's frames are copied (FrameHook), or black. Each source gets a new player with its own device and surface.
struct MpvVideoView : winrt::implements<MpvVideoView, winrt::Windows::Foundation::IInspectable>,
                      Codegen::BaseMpvVideoView<MpvVideoView> {
  ~MpvVideoView() {
    Shutdown();
  }

  void Initialize(const RN::ComponentView &view) noexcept override {
    WindowsPlatform::Init();
    m_dispatcher = view.ReactContext().UIDispatcher();
    m_destroyingRevoker = view.Destroying(winrt::auto_revoke, [weak = get_weak()](auto &&, auto &&) {
      if (auto self = weak.get())
        self->Shutdown();
    });
  }

  Composition::Visual CreateVisual(const RN::ComponentView &view) noexcept override {
    auto compositor = view.as<RN::Composition::ViewComponentView>().Compositor();
    // RNW owns the brush of the visual we return (the view's backgroundColor) and sizes it; the video goes on a
    // child that fills it.
    auto visual = compositor.CreateSpriteVisual();
    m_content = compositor.CreateSpriteVisual();
    m_content.RelativeSizeAdjustment({1, 1});
    visual.Children().InsertAtTop(m_content);
    m_compositor = compositor;
    m_black = compositor.CreateColorBrush(winrt::Windows::UI::Colors::Black());
    m_content.Brush(m_black);
    return visual;
  }

  void UpdateLayoutMetrics(const RN::ComponentView & /*view*/, const RN::LayoutMetrics &newMetrics,
                           const RN::LayoutMetrics & /*oldMetrics*/) noexcept override {
    const float width = newMetrics.Frame.Width * newMetrics.PointScaleFactor;
    const float height = newMetrics.Frame.Height * newMetrics.PointScaleFactor;
    if (width < 1 || height < 1)
      return;
    m_width = int(width + 0.5f);
    m_height = int(height + 0.5f);
    if (m_player)
      m_player->SetSurfaceSize(m_width, m_height); // mpv renders the next frame (or redraws this one) at that size
  }

  void UpdateProps(const RN::ComponentView &view, const winrt::com_ptr<Codegen::MpvVideoViewProps> &newProps,
                   const winrt::com_ptr<Codegen::MpvVideoViewProps> &oldProps) noexcept override {
    BaseMpvVideoView::UpdateProps(view, newProps, oldProps);
    if (!newProps)
      return;
    m_paused = newProps->paused.value_or(false);
    m_muted = newProps->muted.value_or(false);
    m_volume = newProps->volume;
    m_loop = newProps->loop.value_or(false);
    m_rate = newProps->rate;
    const bool audioChanged = newProps->audioTrack != m_audioTrack;
    const bool subtitleChanged = newProps->subtitleTrack != m_subtitleTrack;
    m_audioTrack = newProps->audioTrack;
    m_subtitleTrack = newProps->subtitleTrack;

    const std::string source = newProps->source.value_or("");
    const bool hardware = newProps->hardwareDecoding;
    const bool tlsVerify = newProps->tlsVerify;
    if (source != m_source || hardware != m_hardware || tlsVerify != m_tlsVerify) {
      m_source = source;
      m_hardware = hardware;
      m_tlsVerify = tlsVerify;
      Load();
    } else if (m_player) {
      m_player->SetPaused(m_paused);
      m_player->SetMuted(m_muted);
      m_player->SetVolume(m_volume);
      m_player->SetLoop(m_loop);
      m_player->SetSpeed(m_rate);
      if (audioChanged)
        m_player->SetAudioTrack(m_audioTrack);
      if (subtitleChanged)
        m_player->SetSubtitleTrack(m_subtitleTrack);
    }
  }

  void HandleSeekCommand(double time) noexcept override {
    if (m_player)
      m_player->Seek(time);
  }

 private:
  // Runs fn on the UI thread if the view is still alive and still showing the same source. Called from mpv's event
  // thread, possibly while the player is disposed after its view is gone: it holds no pointer to the view.
  template <typename F>
  static void Post(const RN::IReactDispatcher &dispatcher, const winrt::weak_ref<MpvVideoView> &weak,
                   uint64_t generation, F &&fn) {
    dispatcher.Post([weak, generation, fn = std::forward<F>(fn)]() mutable {
      if (auto self = weak.get(); self && self->m_generation == generation && self->EventEmitter())
        fn(*self->EventEmitter());
    });
  }

  // Also from the destructor and Destroying, when the visuals may be closed already: the player only.
  void Stop() {
    Dispose(std::move(m_player), std::move(m_hook));
  }

  void Load() {
    Stop();
    if (!m_source.empty()) { // its first and last chunks on the way while the output and mpv start
      WindowsPlatform::Init();
      HttpCache::Warm(m_source, m_tlsVerify);
    }
    const uint64_t generation = ++m_generation;
    const auto weak = get_weak();
    const RN::IReactDispatcher dispatcher = m_dispatcher;
    if (!m_compositor)
      return;
    if (m_source.empty()) {
      try {
        m_content.Brush(m_black);
      } catch (const winrt::hresult_error &) { // the visual is closed (the view is going)
      }
      return;
    }
    std::shared_ptr<VideoSurface> surface;
    try {
      surface = std::make_shared<VideoSurface>(VideoDevice::Create(m_compositor), uint32_t(std::max(m_width, 1)),
                                               uint32_t(std::max(m_height, 1)));
      // The surface is kept at the view's size in pixels; Fill only matters while a resize is in flight.
      auto brush = m_compositor.CreateSurfaceBrush(surface->Surface());
      brush.Stretch(Composition::CompositionStretch::Fill);
      m_content.Brush(brush);
    } catch (const winrt::hresult_error &e) {
      return Post(dispatcher, weak, generation,
                  [message = "Cannot create the D3D11 video output: " + winrt::to_string(e.message())](
                      const Codegen::MpvVideoViewEventEmitter &emitter) { emitter.onError({message}); });
    }

    PlayerCallbacks callbacks;
    callbacks.onLoad = [dispatcher, weak, generation](const MediaInfo &info) {
      Codegen::MpvVideoViewEventEmitter::OnLoad e;
      e.duration = info.duration;
      e.width = info.width;
      e.height = info.height;
      e.hasAudio = info.hasAudio;
      e.hwDecoding = info.hwDecoding;
      e.codec = info.codec;
      e.audioTrack = info.audioTrack;
      for (const auto &t : info.audioTracks)
        e.audioTracks.push_back({t.index, t.language, t.title, t.codec, t.channels, t.sampleRate});
      e.subtitleTrack = info.subtitleTrack;
      for (const auto &t : info.subtitleTracks)
        e.subtitleTracks.push_back({t.index, t.language, t.title, t.codec, t.isDefault, t.forced});
      Post(dispatcher, weak, generation,
           [e = std::move(e)](const Codegen::MpvVideoViewEventEmitter &emitter) mutable {
             emitter.onLoad(std::move(e));
           });
    };
    callbacks.onProgress = [dispatcher, weak, generation](double currentTime, double duration) {
      Post(dispatcher, weak, generation, [currentTime, duration](const Codegen::MpvVideoViewEventEmitter &e) {
        e.onProgress({currentTime, duration});
      });
    };
    callbacks.onSeek = [dispatcher, weak, generation](double currentTime) {
      Post(dispatcher, weak, generation,
           [currentTime](const Codegen::MpvVideoViewEventEmitter &e) { e.onSeek({currentTime}); });
    };
    callbacks.onEnd = [dispatcher, weak, generation] {
      Post(dispatcher, weak, generation, [](const Codegen::MpvVideoViewEventEmitter &e) { e.onEnd({}); });
    };
    callbacks.onError = [dispatcher, weak, generation](const std::string &message) {
      Post(dispatcher, weak, generation,
           [message](const Codegen::MpvVideoViewEventEmitter &e) { e.onError({message}); });
    };

    m_hook = std::make_shared<FrameHook>(surface);
    m_player = std::make_unique<MpvPlayer>(0, m_width, m_height, std::move(callbacks));
    m_player->SetD3D11Output(surface->Device(), &m_hook->hook);
    m_player->SetTlsVerify(m_tlsVerify);
    m_player->SetLoop(m_loop);
    m_player->SetByteSourceFactory(HttpCache::MakeSourceFactory(m_tlsVerify));
    m_player->Open(m_source, m_hardware, m_audioTrack);
    m_player->SetPaused(m_paused);
    m_player->SetMuted(m_muted);
    m_player->SetVolume(m_volume);
    m_player->SetSpeed(m_rate);
    m_player->SetSubtitleTrack(m_subtitleTrack);
  }

  void Shutdown() noexcept {
    ++m_generation;
    Stop();
  }

  Composition::Compositor m_compositor{nullptr};
  Composition::SpriteVisual m_content{nullptr};
  Composition::CompositionColorBrush m_black{nullptr};
  std::shared_ptr<FrameHook> m_hook;
  std::unique_ptr<MpvPlayer> m_player;
  RN::IReactDispatcher m_dispatcher{nullptr};
  RN::ComponentView::Destroying_revoker m_destroyingRevoker;
  std::string m_source;
  int m_width = 0, m_height = 0;
  bool m_hardware = true;
  bool m_tlsVerify = true;
  bool m_paused = false;
  bool m_muted = false;
  float m_volume = 1.0f;
  float m_rate = 1.0f;
  bool m_loop = false;
  int m_audioTrack = -1;
  int m_subtitleTrack = MpvPlayer::kSubtitleDefault;
  uint64_t m_generation = 0;
};

} // namespace

void RegisterMpvVideoViewNativeComponent(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
  Codegen::RegisterMpvVideoViewNativeComponent<MpvVideoView>(packageBuilder, {});
}
