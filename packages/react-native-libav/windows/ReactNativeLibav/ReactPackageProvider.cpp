#include "pch.h"

#include "ReactPackageProvider.h"
#if __has_include("ReactPackageProvider.g.cpp")
#include "ReactPackageProvider.g.cpp"
#endif

#include "NativeModules.h"

#include "LibavVideoView.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::ReactNativeLibav::implementation
{

void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept
{
  AddAttributedModules(packageBuilder, true);
#ifdef RNW_NEW_ARCH
  RegisterLibavVideoViewNativeComponent(packageBuilder);
#endif
}

} // namespace winrt::ReactNativeLibav::implementation
