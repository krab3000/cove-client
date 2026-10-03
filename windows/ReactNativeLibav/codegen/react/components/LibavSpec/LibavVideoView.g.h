
/*
 * This file is auto-generated from LibavVideoViewNativeComponent spec file in flow / TypeScript.
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

namespace ReactNativeLibavCodegen {

REACT_STRUCT(LibavVideoViewProps)
struct LibavVideoViewProps : winrt::implements<LibavVideoViewProps, winrt::Microsoft::ReactNative::IComponentProps> {
  LibavVideoViewProps(winrt::Microsoft::ReactNative::ViewProps props, const winrt::Microsoft::ReactNative::IComponentProps& cloneFrom)
    : ViewProps(props)
  {
     if (cloneFrom) {
       auto cloneFromProps = cloneFrom.as<LibavVideoViewProps>();
       source = cloneFromProps->source;
       paused = cloneFromProps->paused;
       muted = cloneFromProps->muted;
       volume = cloneFromProps->volume;
       loop = cloneFromProps->loop;
       hardwareDecoding = cloneFromProps->hardwareDecoding;
       onLoad = cloneFromProps->onLoad;
       onProgress = cloneFromProps->onProgress;
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

   // These fields can be used to determine if JS has registered for this event
  REACT_FIELD(onLoad)
  bool onLoad{false};

  REACT_FIELD(onProgress)
  bool onProgress{false};

  REACT_FIELD(onEnd)
  bool onEnd{false};

  REACT_FIELD(onError)
  bool onError{false};

  const winrt::Microsoft::ReactNative::ViewProps ViewProps;
};

REACT_STRUCT(LibavVideoViewSpec_onError)
struct LibavVideoViewSpec_onError {
  REACT_FIELD(message)
  std::string message;
};

REACT_STRUCT(LibavVideoViewSpec_onEnd)
struct LibavVideoViewSpec_onEnd {
};

REACT_STRUCT(LibavVideoViewSpec_onProgress)
struct LibavVideoViewSpec_onProgress {
  REACT_FIELD(currentTime)
  double currentTime{};

  REACT_FIELD(duration)
  double duration{};
};

REACT_STRUCT(LibavVideoViewSpec_onLoad)
struct LibavVideoViewSpec_onLoad {
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
};

struct LibavVideoViewEventEmitter {
  LibavVideoViewEventEmitter(const winrt::Microsoft::ReactNative::EventEmitter &eventEmitter)
      : m_eventEmitter(eventEmitter) {}

  using OnLoad = LibavVideoViewSpec_onLoad;
  using OnProgress = LibavVideoViewSpec_onProgress;
  using OnEnd = LibavVideoViewSpec_onEnd;
  using OnError = LibavVideoViewSpec_onError;

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
struct BaseLibavVideoView {

  virtual void UpdateProps(
    const winrt::Microsoft::ReactNative::ComponentView &/*view*/,
    const winrt::com_ptr<LibavVideoViewProps> &newProps,
    const winrt::com_ptr<LibavVideoViewProps> &/*oldProps*/) noexcept {
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

  virtual void UpdateEventEmitter(const std::shared_ptr<LibavVideoViewEventEmitter> &eventEmitter) noexcept {
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

  

  const std::shared_ptr<LibavVideoViewEventEmitter>& EventEmitter() const { return m_eventEmitter; }
  const winrt::com_ptr<LibavVideoViewProps>& Props() const { return m_props; }

private:
  winrt::com_ptr<LibavVideoViewProps> m_props;
  std::shared_ptr<LibavVideoViewEventEmitter> m_eventEmitter;
};

template <typename TUserData>
void RegisterLibavVideoViewNativeComponent(
    winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder,
    std::function<void(const winrt::Microsoft::ReactNative::Composition::IReactCompositionViewComponentBuilder&)> builderCallback) noexcept {
  packageBuilder.as<winrt::Microsoft::ReactNative::IReactPackageBuilderFabric>().AddViewComponent(
      L"LibavVideoView", [builderCallback](winrt::Microsoft::ReactNative::IReactViewComponentBuilder const &builder) noexcept {
        auto compBuilder = builder.as<winrt::Microsoft::ReactNative::Composition::IReactCompositionViewComponentBuilder>();

        builder.SetCreateProps([](winrt::Microsoft::ReactNative::ViewProps props,
                              const winrt::Microsoft::ReactNative::IComponentProps& cloneFrom) noexcept {
            return winrt::make<LibavVideoViewProps>(props, cloneFrom); 
        });

        builder.SetUpdatePropsHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     const winrt::Microsoft::ReactNative::IComponentProps &newProps,
                                     const winrt::Microsoft::ReactNative::IComponentProps &oldProps) noexcept {
            auto userData = view.UserData().as<TUserData>();
            userData->UpdateProps(view, newProps ? newProps.as<LibavVideoViewProps>() : nullptr, oldProps ? oldProps.as<LibavVideoViewProps>() : nullptr);
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
          userData->UpdateEventEmitter(std::make_shared<LibavVideoViewEventEmitter>(eventEmitter));
        });

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::FinalizeUpdate != &BaseLibavVideoView<TUserData>::FinalizeUpdate) {
            builder.SetFinalizeUpdateHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     winrt::Microsoft::ReactNative::ComponentViewUpdateMask mask) noexcept {
            auto userData = view.UserData().as<TUserData>();
            userData->FinalizeUpdate(view, mask);
          });
        } 

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::UpdateState != &BaseLibavVideoView<TUserData>::UpdateState) {
          builder.SetUpdateStateHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     const winrt::Microsoft::ReactNative::IComponentState &newState) noexcept {
            auto userData = view.UserData().as<TUserData>();
            userData->UpdateState(view, newState);
          });
        }

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::MountChildComponentView != &BaseLibavVideoView<TUserData>::MountChildComponentView) {
          builder.SetMountChildComponentViewHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                      const winrt::Microsoft::ReactNative::MountChildComponentViewArgs &args) noexcept {
            auto userData = view.UserData().as<TUserData>();
            return userData->MountChildComponentView(view, args);
          });
        }

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::UnmountChildComponentView != &BaseLibavVideoView<TUserData>::UnmountChildComponentView) {
          builder.SetUnmountChildComponentViewHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                      const winrt::Microsoft::ReactNative::UnmountChildComponentViewArgs &args) noexcept {
            auto userData = view.UserData().as<TUserData>();
            return userData->UnmountChildComponentView(view, args);
          });
        }

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::CreateAutomationPeer != &BaseLibavVideoView<TUserData>::CreateAutomationPeer) {
            builder.SetCreateAutomationPeerHandler([](const winrt::Microsoft::ReactNative::ComponentView &view,
                                     const winrt::Microsoft::ReactNative::CreateAutomationPeerArgs& args) noexcept {
            auto userData = view.UserData().as<TUserData>();
            return userData->CreateAutomationPeer(view, args);
          });
        } 

        compBuilder.SetViewComponentViewInitializer([](const winrt::Microsoft::ReactNative::ComponentView &view) noexcept {
          auto userData = winrt::make_self<TUserData>();
          if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::Initialize != &BaseLibavVideoView<TUserData>::Initialize) {
            userData->Initialize(view);
          }
          view.UserData(*userData);
        });

        if CONSTEXPR_SUPPORTED_ON_VIRTUAL_FN_ADDRESS (&TUserData::CreateVisual != &BaseLibavVideoView<TUserData>::CreateVisual) {
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

} // namespace ReactNativeLibavCodegen

#endif // #ifdef RNW_NEW_ARCH
