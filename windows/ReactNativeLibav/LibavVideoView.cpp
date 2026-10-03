#include "pch.h"

#include "LibavVideoView.h"

#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Windows.UI.h>
#include <winrt/Microsoft.UI.Composition.interop.h>

#include "codegen/react/components/LibavSpec/LibavVideoView.g.h"
#include "engine/Player.h"

namespace Codegen = ReactNativeLibavCodegen;
namespace RN = winrt::Microsoft::ReactNative;
namespace Composition = winrt::Microsoft::UI::Composition;

namespace {

using namespace ReactNativeLibav;

// <LibavVideoView>: a SpriteVisual showing a GPU composition surface that a Player renders into from its own
// thread. The visual, device and surface live as long as the view; a new Player is made for each source.
struct LibavVideoView : winrt::implements<LibavVideoView, winrt::Windows::Foundation::IInspectable>,
                        Codegen::BaseLibavVideoView<LibavVideoView> {
  ~LibavVideoView() {
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
    auto compositor = view.as<RN::Composition::ViewComponentView>().Compositor();
    // RNW owns the brush of the visual we return (it is the view's backgroundColor, reset on theme changes), and
    // sizes it; the video goes on a child that fills it.
    auto visual = compositor.CreateSpriteVisual();
    m_content = compositor.CreateSpriteVisual();
    m_content.RelativeSizeAdjustment({1, 1});
    visual.Children().InsertAtTop(m_content);
    try {
      m_output = std::make_shared<VideoOutput>(compositor);
      // The surface is kept at the view's size in pixels; Fill only matters while a resize is in flight.
      auto brush = compositor.CreateSurfaceBrush(m_output->Surface());
      brush.Stretch(Composition::CompositionStretch::Fill);
      m_content.Brush(brush);
    } catch (const winrt::hresult_error &e) {
      m_output = nullptr;
      m_initError = "Cannot create the D3D11 video output: " + winrt::to_string(e.message());
    }
    return visual;
  }

  void UpdateLayoutMetrics(const RN::ComponentView & /*view*/, const RN::LayoutMetrics &newMetrics,
                           const RN::LayoutMetrics & /*oldMetrics*/) noexcept override {
    const float width = newMetrics.Frame.Width * newMetrics.PointScaleFactor;
    const float height = newMetrics.Frame.Height * newMetrics.PointScaleFactor;
    if (m_output && width >= 1 && height >= 1) {
      m_output->Resize(uint32_t(width + 0.5f), uint32_t(height + 0.5f));
      if (!m_player)
        PresentBlack();
    }
  }

  void UpdateProps(const RN::ComponentView &view, const winrt::com_ptr<Codegen::LibavVideoViewProps> &newProps,
                   const winrt::com_ptr<Codegen::LibavVideoViewProps> &oldProps) noexcept override {
    BaseLibavVideoView::UpdateProps(view, newProps, oldProps);
    if (!newProps)
      return;
    m_paused = newProps->paused.value_or(false);
    m_muted = newProps->muted.value_or(false);
    m_volume = newProps->volume;
    m_loop = newProps->loop.value_or(false);

    const std::string source = newProps->source.value_or("");
    const bool hardware = newProps->hardwareDecoding;
    if (source != m_source || hardware != m_hardware) {
      m_source = source;
      m_hardware = hardware;
      Load();
    } else if (m_player) {
      m_player->SetPaused(m_paused);
      m_player->SetMuted(m_muted);
      m_player->SetVolume(m_volume);
      m_player->SetLoop(m_loop);
    }
  }

 private:
  void Load() {
    m_player.reset(); // joins the previous player's threads
    const uint64_t generation = ++m_generation;
    if (m_source.empty())
      return PresentBlack();
    if (!m_output)
      return Emit(generation, [message = m_initError](LibavVideoView &self) {
        if (self.EventEmitter())
          self.EventEmitter()->onError({message});
      });

    PlayerCallbacks callbacks;
    callbacks.onLoad = [this, weak = get_weak(), generation](const MediaInfo &info) {
      Post(weak, generation, [info](LibavVideoView &self) {
        if (self.EventEmitter())
          self.EventEmitter()->onLoad(
              {info.duration, info.width, info.height, info.hasAudio, info.hwDecoding, info.codec});
      });
    };
    callbacks.onProgress = [this, weak = get_weak(), generation](double currentTime, double duration) {
      Post(weak, generation, [currentTime, duration](LibavVideoView &self) {
        if (self.EventEmitter())
          self.EventEmitter()->onProgress({currentTime, duration});
      });
    };
    callbacks.onEnd = [this, weak = get_weak(), generation] {
      Post(weak, generation, [](LibavVideoView &self) {
        if (self.EventEmitter())
          self.EventEmitter()->onEnd({});
      });
    };
    callbacks.onError = [this, weak = get_weak(), generation](const std::string &message) {
      Post(weak, generation, [message](LibavVideoView &self) {
        if (self.EventEmitter())
          self.EventEmitter()->onError({message});
      });
    };

    m_player = std::make_unique<Player>(m_output, std::move(callbacks));
    m_player->SetPaused(m_paused);
    m_player->SetMuted(m_muted);
    m_player->SetVolume(m_volume);
    m_player->SetLoop(m_loop);
    m_player->Open(m_source, m_hardware);
  }

  // Runs on the UI thread if this view is still alive and still showing the same source.
  template <typename F>
  void Post(winrt::weak_ref<LibavVideoView> weak, uint64_t generation, F &&fn) {
    m_dispatcher.Post([weak = std::move(weak), generation, fn = std::forward<F>(fn)] {
      if (auto self = weak.get(); self && self->m_generation == generation)
        fn(*self);
    });
  }

  template <typename F>
  void Emit(uint64_t generation, F &&fn) {
    Post(get_weak(), generation, std::forward<F>(fn));
  }

  void PresentBlack() {
    try {
      if (m_output)
        m_output->Present(nullptr);
    } catch (const winrt::hresult_error &) {
    }
  }

  void Shutdown() noexcept {
    ++m_generation;
    m_player.reset();
  }

  Composition::SpriteVisual m_content{nullptr};
  std::shared_ptr<VideoOutput> m_output;
  std::unique_ptr<Player> m_player;
  RN::IReactDispatcher m_dispatcher{nullptr};
  RN::ComponentView::Destroying_revoker m_destroyingRevoker;
  std::string m_initError;
  std::string m_source;
  bool m_hardware = true;
  bool m_paused = false;
  bool m_muted = false;
  float m_volume = 1.0f;
  bool m_loop = false;
  uint64_t m_generation = 0;
};

} // namespace

void RegisterLibavVideoViewNativeComponent(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
  Codegen::RegisterLibavVideoViewNativeComponent<LibavVideoView>(packageBuilder, {});
}
