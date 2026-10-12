cmake_minimum_required(VERSION 3.22)

# The RnTrace TurboModule, built into the app's native modules by autolinking (react-native.config.js). It links the
# shared librntrace through Prefab (rn-trace's Android module), the one other native libraries link too.

add_library(rntrace_module STATIC ${CMAKE_CURRENT_SOURCE_DIR}/RnTraceModule.cpp)
target_include_directories(rntrace_module PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
find_package(rn-trace REQUIRED CONFIG) # Prefab: the package is named after the Gradle project
target_link_libraries(rntrace_module
  rn-trace::rntrace
  react_codegen_RnTraceSpec
  ReactAndroid::jsi
  ReactAndroid::reactnative)
target_compile_options(rntrace_module PRIVATE -std=c++20)
