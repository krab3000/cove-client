#include "pch.h"

#include "ReactPackageProvider.h"
#if __has_include("ReactPackageProvider.g.cpp")
#include "ReactPackageProvider.g.cpp"
#endif

#include "NativeModules.h"

#include "MpvCacheModule.h"
#include "MpvVideoView.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::ReactNativeMpv::implementation
{

void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept
{
  AddAttributedModules(packageBuilder, true);
#ifdef RNW_NEW_ARCH
  RegisterMpvVideoViewNativeComponent(packageBuilder);
#endif
}

} // namespace winrt::ReactNativeMpv::implementation
