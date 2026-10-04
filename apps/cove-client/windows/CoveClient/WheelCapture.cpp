#include "pch.h"

#include "WheelCapture.h"

#include <winrt/Microsoft.ReactNative.Composition.Input.h>

#include "codegen/react/components/CoveClientSpec/WheelCapture.g.h"

namespace RN = winrt::Microsoft::ReactNative;

namespace {

// <WheelCapture>: a plain view that takes vertical mouse wheel events before the ScrollView around it and reports
// them to JS (onWheel), which scrolls by its own step. Wheel events go to the view under the pointer and bubble up
// until handled; the ScrollView would otherwise scroll a fixed 120 px per notch.
struct WheelCapture : winrt::implements<WheelCapture, winrt::Windows::Foundation::IInspectable>,
                      CoveClientCodegen::BaseWheelCapture<WheelCapture> {
  void Initialize(const RN::ComponentView &view) noexcept override {
    m_wheelRevoker = view.PointerWheelChanged(
        winrt::auto_revoke,
        [weak = get_weak()](const winrt::Windows::Foundation::IInspectable &,
                            const RN::Composition::Input::PointerRoutedEventArgs &args) {
          auto self = weak.get();
          if (!self || !self->EventEmitter())
            return;
          const auto properties = args.GetCurrentPoint(-1).Properties();
          if (properties.IsHorizontalMouseWheel())
            return; // left to the ScrollView
          args.Handled(true);
          self->EventEmitter()->onWheel({double(properties.MouseWheelDelta())});
        });
  }

 private:
  RN::ComponentView::PointerWheelChanged_revoker m_wheelRevoker;
};

} // namespace

void RegisterWheelCaptureNativeComponent(RN::IReactPackageBuilder const &packageBuilder) noexcept {
  CoveClientCodegen::RegisterWheelCaptureNativeComponent<WheelCapture>(packageBuilder, {});
}
