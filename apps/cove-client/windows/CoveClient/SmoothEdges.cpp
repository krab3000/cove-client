#include "pch.h"

#include "SmoothEdges.h"

#include <winrt/Microsoft.ReactNative.Composition.h>
#include <winrt/Microsoft.UI.Composition.h>

#include "codegen/react/components/CoveClientSpec/SmoothEdges.g.h"

namespace RN = winrt::Microsoft::ReactNative;

namespace {

// <SmoothEdges>: an empty view that sets its island's root visual to BorderMode Soft once mounted. React Native
// Windows rounds corners with composition clips (geometric clips over the view's visual), which composition draws
// aliased in the default (hard) border mode; Soft anti-aliases the edges of clips and bitmaps in the whole subtree.
// Each Modal is an island of its own, hence one per root.
struct SmoothEdges : winrt::implements<SmoothEdges, winrt::Windows::Foundation::IInspectable>,
                     CoveClientCodegen::BaseSmoothEdges<SmoothEdges> {
  void Initialize(const RN::ComponentView &view) noexcept override {
    m_mountedRevoker = view.Mounted(winrt::auto_revoke, [](const auto &, const RN::ComponentView &mounted) {
      try {
        auto root = mounted.as<RN::Composition::ComponentView>().Root();
        if (!root)
          return;
        if (auto island = root.ReactNativeIsland())
          if (auto visual = island.RootVisual())
            visual.BorderMode(winrt::Microsoft::UI::Composition::CompositionBorderMode::Soft);
      } catch (const winrt::hresult_error &) {
        // No island (yet): the corners stay as they are.
      }
    });
  }

 private:
  RN::ComponentView::Mounted_revoker m_mountedRevoker;
};

} // namespace

void RegisterSmoothEdgesNativeComponent(RN::IReactPackageBuilder const &packageBuilder) noexcept {
  CoveClientCodegen::RegisterSmoothEdgesNativeComponent<SmoothEdges>(packageBuilder, {});
}
