// The RnTrace TurboModule is C++ (cpp/module): autolinking builds it into the app's native modules and registers it.
module.exports = {
  dependency: {
    platforms: {
      android: {
        cxxModuleCMakeListsModuleName: 'rntrace_module',
        cxxModuleCMakeListsPath: '../cpp/module/CMakeLists.txt', // relative to android/
        cxxModuleHeaderName: 'RnTraceModule',
      },
      ios: null,
      windows: null,
    },
  },
};
