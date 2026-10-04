
/*
 * This file is auto-generated from VlcVideoViewNativeComponent spec file in flow / TypeScript.
 */
// clang-format off
#pragma once

#include <NativeModules.h>

#ifdef RNW_NEW_ARCH
#include <JSValueComposition.h>

#include <winrt/Microsoft.ReactNative.Composition.h>
#include <winrt/Microsoft.UI.Composition.h>
#endif // #ifdef RNW_NEW_ARCH

#ifdef RNW_NEW_ARCH

namespace ReactNativeVlcCodegen {

REACT_STRUCT(VlcVideoViewProps)
struct VlcVideoViewProps : winrt::implements<VlcVideoViewProps, winrt::Microsoft::ReactNative::IComponentProps> {
  VlcVideoViewProps(winrt::Microsoft::ReactNative::ViewProps props, const winrt::Microsoft::ReactNative::IComponentProps& cloneFrom)
    : ViewProps(props)
  {
     if (cloneFrom) {
       auto cloneFromProps = cloneFrom.as<VlcVideoViewProps>();
       source = cloneFromProps->source;
       paused = cloneFromProps->paused;
       muted = cloneFromProps->muted;
       volume = cloneFromProps->volume;
       loop = cloneFromProps->loop;
       hardwareDecoding = cloneFromProps->hardwareDecoding;
       tlsVerify = cloneFromProps->tlsVerify;
       audioTrack = cloneFromProps->audioTrack;
       subtitleTrack = cloneFromProps->subtitleTrack;
       overlay = cloneFromProps->overlay;
       cache = cloneFromProps->cache;
       onLoad = cloneFromProps->onLoad;
       onProgress = cloneFromProps->onProgress;
       onSeek = cloneFromProps->onSeek;
       onEnd = cloneFromProps->onEnd;
       onError = cloneFromProps->onError;  
     }
  }

  void SetProp(uint32_t hash, winrt::hstring propName, winrt::Microsoft::ReactNative::IJSValueReader value) noexcept {
    winrt::Microsoft::ReactNative::ReadProp(hash, propName, value, *this);
  }

  REACT_FIELD(source)
  std::optional<std::string> source;

  REACT_FIELD(paused)
  std::optional<bool> paused{};

  REACT_FIELD(muted)
  std::optional<bool> muted{};

  REACT_FIELD(volume)
  float volume{1};

  REACT_FIELD(loop)
  std::optional<bool> loop{};

  REACT_FIELD(hardwareDecoding)
  bool hardwareDecoding{true};

  REACT_FIELD(tlsVerify)
  bool tlsVerify{true};

  REACT_FIELD(audioTrack)
  int32_t audioTrack{-1};

  REACT_FIELD(subtitleTrack)
  int32_t subtitleTrack{-1};

  REACT_FIELD(overlay)
  std::optional<bool> overlay{};

  REACT_FIELD(cache)
  std::optional<bool> cache{};

   // These fields can be used to determine if JS has registered for this event
  REACT_FIELD(onLoad)
  bool onLoad{false};

  REACT_FIELD(onProgress)
  bool onProgress{false};

  REACT_FIELD(onSeek)
  bool onSeek{false};

  REACT_FIELD(onEnd)
  bool onEnd{false};

  REACT_FIELD(onError)
  bool onError{false};

  const winrt::Microsoft::ReactNative::ViewProps ViewProps;
};

REACT_STRUCT(VlcVideoViewSpec_onLoad3)
struct VlcVideoViewSpec_onLoad3 {
  REACT_FIELD(index)
  int32_t index{};

  REACT_FIELD(language)
  std::string language;

  REACT_FIELD(title)
  std::string title;

  REACT_FIELD(codec)
  std::string codec;
};

REACT_STRUCT(VlcVideoViewSpec_onLoad2)
struct VlcVideoViewSpec_onLoad2 {
  REACT_FIELD(index)
  int32_t index{};

  REACT_FIELD(language)
  std::string language;

  REACT_FIELD(title)
  std::string title;

  REACT_FIELD(codec)
  std::string codec;

  REACT_FIELD(channels)
  int32_t channels{};

  REACT_FIELD(sampleRate)
  int32_t sampleRate{};
};

REACT_STRUCT(VlcVideoViewSpec_onError)
struct VlcVideoViewSpec_onError {
  REACT_FIELD(message)
  std::string message;
};

REACT_STRUCT(VlcVideoViewSpec_onEnd)
struct VlcVideoViewSpec_onEnd {
};

REACT_STRUCT(VlcVideoViewSpec_onSeek)
struct VlcVideoViewSpec_onSeek {
  REACT_FIELD(currentTime)
  double currentTime{};
};

REACT_STRUCT(VlcVideoViewSpec_onProgress)
struct VlcVideoViewSpec_onProgress {
  REACT_FIELD(currentTime)
  double currentTime{};

  REACT_FIELD(duration)
  double duration{};
};

REACT_STRUCT(VlcVideoViewSpec_onLoad)
struct VlcVideoViewSpec_onLoad {
  REACT_FIELD(duration)
  double duration{};

  REACT_FIELD(width)
  int32_t width{};

  REACT_FIELD(height)
  int32_t height{};

  REACT_FIELD(hasAudio)
  bool hasAudio{};

  REACT_FIELD(hwDecoding)
  bool hwDecoding{};

  REACT_FIELD(codec)
  std::string codec;

  REACT_FIELD(audioTracks)
  std::vector<VlcVideoViewSpec_onLoad2> audioTracks{};

  REACT_FIELD(audioTrack)
  int32_t audioTrack{};

  REACT_FIELD(subtitleTracks)
  std::vector<VlcVideoViewSpec_onLoad3> subtitleTracks{};

  REACT_FIELD(subtitleTrack)
  int32_t subtitleTrack{};
};

struct VlcVideoViewEventEmitter {
  VlcVideoViewEventEmitter(const winrt::Microsoft::ReactNative::EventEmitter &eventEmitter)
      : m_eventEmitter(eventEmitter) {}

  using OnLoad = VlcVideoViewSpec_onLoad;
  using OnProgress = VlcVideoViewSpec_onProgress;
  using OnSeek = VlcVideoViewSpec_onSeek;
  using OnEnd = VlcVideoViewSpec_onEnd;
  using OnError = VlcVideoViewSpec_onError;

  void onLoad(OnLoad &&value) const {
    m_eventEmitter.DispatchEvent(L"load", [value = std::move(value)](const winrt::Microsoft::ReactNative::IJSValueWriter writer) {
      winrt::Microsoft::ReactNative::WriteValue(writer, value);
    });
  }

  void onProgress(OnProgress &&value) const {
    m_eventEmitter.DispatchEvent(L"progress", [value = std::move(value)](const winrt::Microsoft::ReactNative::IJSValueWriter writer) {
      winrt::Microsoft::ReactNative::WriteValue(writer, value);
    });
  }

  void onSeek(OnSeek &&value) const {
    m_eventEmitter.DispatchEvent(L"seek", [value = std::move(value)](const winrt::Microsoft::ReactNative::IJSValueWriter writer) {
      winrt::Microsoft::ReactNative::WriteValue(writer, value);
    });
  }

  void onEnd(OnEnd &&value) const {
    m_eventEmitter.DispatchEvent(L"end", [value = std::move(value)](const winrt::Microsoft::ReactNative::IJSValueWriter writer) {
      winrt::Microsoft::ReactNative::WriteValue(writer, value);
    });
  }

  void onError(OnError &&value) const {
    m_eventEmitter.DispatchEvent(L"error", [value = std::move(value)](const winrt::Microsoft::ReactNative::IJSValueWriter writer) {
      winrt::Microsoft::ReactNative::WriteValue(writer, value);
    });
  }

 private:
  winrt::Microsoft::ReactNative::EventEmitter m_eventEmitter{nullptr};
};

template<typename TUserData>
struct BaseVlcVideoView {

  virtual void UpdateProps(
    const winrt::Microsoft::ReactNative::ComponentView &/*view*/,
    const winrt::com_ptr<VlcVideoViewProps> &newProps,
    const winrt::com_ptr<VlcVideoViewProps> &/*oldProps*/) noexcept {
    m_props = newProps;
  }

  // UpdateLayoutMetrics will only be called if this method is overridden
  virtual void UpdateLayoutMetrics(
    const winrt::Microsoft::ReactNative::ComponentView &/*view*/,
    const winrt::Microsoft::ReactNative::LayoutMetrics &/*newLayoutMetrics*/,
    const winrt::Microsoft::ReactNative::LayoutMetrics &/*oldLayoutMetrics*/) noexcept {
  }

  // UpdateState will only be called if this method is overridden
  virtual void UpdateState(
    const winrt::Microsoft::ReactNative::ComponentView &/*view*/,
    const winrt::Microsoft::ReactNative::IComponentState &/*newState*/) noexcept {
  }

  virtual void UpdateEventEmitter(const std::shared_ptr<VlcVideoViewEventEmitter> &eventEmitter) noexcept {
    m_eventEmitter = eventEmitter;
  }

  // MountChildComponentView will only be called if this method is overridden
  virtual void MountChildComponentView(const winrt::Microsoft::ReactNative::ComponentView &/*view*/,
           const winrt::Microsoft::ReactNative::MountChildComponentViewArgs &/*args*/) noexcept {
  }

  // UnmountChildComponentView will only be called if this method is overridden
  virtual void UnmountChildComponentView(const winrt::Microsoft::ReactNative::ComponentView &/*view*/,
           const winrt::Microsoft::ReactNative::UnmountChildComponentViewArgs &/*args*/) noexcept {
  }

  // Initialize will only be called if this method is overridden
  virtual void Initialize(const winrt::Microsoft::ReactNative::ComponentView &/*view*/) noexcept {
  }

  // CreateVisual will only be called if this method is overridden
  virtual winrt::Microsoft::UI::Composition::Visual CreateVisual(const winrt::Microsoft::ReactNative::ComponentView &view) noexcept {
    return view.as<winrt::Microsoft::ReactNative::Composition::ComponentView>().Compositor().CreateSpriteVisual();
  }

  // FinalizeUpdate will only be called if this method is overridden
  virtual void FinalizeUpdate(const winrt::Microsoft::ReactNative::ComponentView &/*view*/,
                                        winrt::Microsoft::ReactNative::ComponentViewUpdateMask /*mask*/) noexcept {
  }

  // CreateAutomationPeer will only be called if this method is overridden
  virtual winrt::Windows::Foundation::IInspectable CreateAutomationPeer(const winrt::Microsoft::ReactNative::ComponentView & /*view*/,
                                        const winrt::Microsoft::ReactNative::CreateAutomationPeerArgs& /*args*/) noexcept {
    return nullptr;
  }

  // You must provide an implementation of this method to handle the "seek" command
  virtual void HandleSeekCommand(double time) noexcept = 0;

  void HandleCommand(const winrt::Microsoft::ReactNative::ComponentView &view, const winrt::Microsoft::ReactNative::HandleCommandArgs& args) noexcept {
    auto userData = view.UserData().as<TUserData>();
    auto commandName = args.CommandName();
    if (commandName == L"seek") {
      double time;
      winrt::Microsoft::ReactNative::ReadArgs(args.CommandArgs(), time);
      userData->HandleSeekCommand(time);
      return;
    }
  }

  const std::shared_ptr<VlcVideoViewEventEmitter>& EventEmitter() const { return m_eventEmitter; }
  const winrt::com_ptr<VlcVideoViewProps>& Props() const { return m_props; }

private:
  winrt::com_ptr<VlcVideoViewProps> m_props;
  std::shared_ptr<VlcVideoViewEventEmitter> m_eventEmitter;
};

template <typename TUserData>
void RegisterVlcVideoViewNativeComponent(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder,
    std::function<void(const winrt::Microsoft::ReactNative::Composition::IReactCompositionViewComponentBuilder&)> builderCallback) noexcept {
  packageBuilder.as<winrt::Microsoft::ReactNative::IReactPackageBuilderFabric>().AddViewComponent(
      L"VlcVideoView", [builderCallback](winrt::Microsoft::ReactNative::IReactViewComponentBuilder const &builder) noexcept {
        auto compBuilder = builder.as<winrt::Microsoft::ReactNative::Composition::IReactCompositionViewComponentBuilder>();

        builder.SetCreateProps([](winrt::Microsoft::ReactNative::ViewProps props,
                              const winrt::Microsoft::ReactNative::IComponentProps& cloneFrom) noexcept {
            return winrt::make<VlcVideoViewProps>(props, cloneFrom); 
        });

        builder.SetUpdatePropsHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     const winrt::Microsoft::ReactNative::IComponentProps &newProps,
                                     const winrt::Microsoft::ReactNative::IComponentProps &oldProps) noexcept {
            auto userData = view.UserData().as<TUserData>();
            userData->UpdateProps(view, newProps ? newProps.as<VlcVideoViewProps>() : nullptr, oldProps ? oldProps.as<VlcVideoViewProps>() : nullptr);
        });

        compBuilder.SetUpdateLayoutMetricsHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                      const winrt::Microsoft::ReactNative::LayoutMetrics &newLayoutMetrics,
                                      const winrt::Microsoft::ReactNative::LayoutMetrics &oldLayoutMetrics) noexcept {
            auto userData = view.UserData().as<TUserData>();
            userData->UpdateLayoutMetrics(view, newLayoutMetrics, oldLayoutMetrics);
        });

        builder.SetUpdateEventEmitterHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     const winrt::Microsoft::ReactNative::EventEmitter &eventEmitter) noexcept {
          auto userData = view.UserData().as<TUserData>();
          userData->UpdateEventEmitter(std::make_shared<VlcVideoViewEventEmitter>(eventEmitter));
        });

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::FinalizeUpdate != &BaseVlcVideoView<TUserData>::FinalizeUpdate) {
            builder.SetFinalizeUpdateHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     winrt::Microsoft::ReactNative::ComponentViewUpdateMask mask) noexcept {
            auto userData = view.UserData().as<TUserData>();
            userData->FinalizeUpdate(view, mask);
          });
        } 

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::UpdateState != &BaseVlcVideoView<TUserData>::UpdateState) {
          builder.SetUpdateStateHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     const winrt::Microsoft::ReactNative::IComponentState &newState) noexcept {
            auto userData = view.UserData().as<TUserData>();
            userData->UpdateState(view, newState);
          });
        }

        builder.SetCustomCommandHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                          const winrt::Microsoft::ReactNative::HandleCommandArgs& args) noexcept {
          auto userData = view.UserData().as<TUserData>();
          userData->HandleCommand(view, args);
        });

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::MountChildComponentView != &BaseVlcVideoView<TUserData>::MountChildComponentView) {
          builder.SetMountChildComponentViewHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                      const winrt::Microsoft::ReactNative::MountChildComponentViewArgs &args) noexcept {
            auto userData = view.UserData().as<TUserData>();
            return userData->MountChildComponentView(view, args);
          });
        }

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::UnmountChildComponentView != &BaseVlcVideoView<TUserData>::UnmountChildComponentView) {
          builder.SetUnmountChildComponentViewHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                      const winrt::Microsoft::ReactNative::UnmountChildComponentViewArgs &args) noexcept {
            auto userData = view.UserData().as<TUserData>();
            return userData->UnmountChildComponentView(view, args);
          });
        }

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::CreateAutomationPeer != &BaseVlcVideoView<TUserData>::CreateAutomationPeer) {
            builder.SetCreateAutomationPeerHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     const winrt::Microsoft::ReactNative::CreateAutomationPeerArgs& args) noexcept {
            auto userData = view.UserData().as<TUserData>();
            return userData->CreateAutomationPeer(view, args);
          });
        } 

        compBuilder.SetViewComponentViewInitializer([](const winrt::Microsoft::ReactNative::ComponentView &view) noexcept {
          auto userData = winrt::make_self<TUserData>();
          if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::Initialize != &BaseVlcVideoView<TUserData>::Initialize) {
            userData->Initialize(view);
          }
          view.UserData(*userData);
        });

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::CreateVisual != &BaseVlcVideoView<TUserData>::CreateVisual) {
          compBuilder.SetCreateVisualHandler([](const winrt::Microsoft::ReactNative::ComponentView &view) noexcept {
            auto userData = view.UserData().as<TUserData>();
            return userData->CreateVisual(view);
          });
        }

        // Allow app to further customize the builder
        if (builderCallback) {
          builderCallback(compBuilder);
        }
      });
}

} // namespace ReactNativeVlcCodegen

#endif // #ifdef RNW_NEW_ARCH
