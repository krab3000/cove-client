cmake_minimum_required(VERSION 3.22)
project(reactnativempv CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The player (../cpp: MpvPlayer and the HTTP cache) and the JNI bridge. libmpv and the FFmpeg it links are built by
# scripts/ffmpeg-android and scripts/mpv-android into third_party/{ffmpeg,mpv}/android-<abi>. libmpv.so is loaded at
# run time (dlopen, cpp/MpvPlayer.cpp): only its headers are needed here. FFmpeg's libavcodec: av_jni_set_java_vm.
set(ENGINE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../cpp)
set(FFMPEG_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/ffmpeg/android-${ANDROID_ABI})
set(MPV_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/mpv/android-${ANDROID_ABI})
if(NOT EXISTS ${FFMPEG_DIR}/include/libavcodec/avcodec.h)
  message(FATAL_ERROR "FFmpeg for Android not found in ${FFMPEG_DIR}. Run: yarn turbo run build:android:docker --filter=react-native-mpv")
endif()
if(NOT EXISTS ${MPV_DIR}/include/mpv/client.h)
  message(FATAL_ERROR "libmpv for Android not found in ${MPV_DIR}. Run: yarn turbo run build:android:docker --filter=react-native-mpv")
endif()

file(GLOB ENGINE_SOURCES CONFIGURE_DEPENDS ${ENGINE_DIR}/*.cpp) # new files are picked up without a reconfigure
add_library(reactnativempv SHARED ${ENGINE_SOURCES} src/main/cpp/MpvJni.cpp)
target_include_directories(reactnativempv PRIVATE ${ENGINE_DIR} src/main/cpp ${FFMPEG_DIR}/include ${MPV_DIR}/include)
target_compile_options(reactnativempv PRIVATE -Wall -Wno-unknown-pragmas -fvisibility=hidden)

add_library(avcodec SHARED IMPORTED)
set_target_properties(avcodec PROPERTIES IMPORTED_LOCATION ${FFMPEG_DIR}/lib/libavcodec.so)
target_link_libraries(reactnativempv avcodec android dl log nativewindow)

# Trace points (cpp/Trace.h) through rn-trace, the process's one tracer, when the app has it (android/build.gradle
# passes MPV_RNTRACE and brings its Prefab package).
if(MPV_RNTRACE)
  find_package(rn-trace REQUIRED CONFIG) # Prefab: the package is named after the Gradle project
  target_link_libraries(reactnativempv rn-trace::rntrace)
  target_compile_definitions(reactnativempv PRIVATE MPV_RNTRACE)
  message(STATUS "react-native-mpv: trace points through rn-trace")
endif()
# 16 KB page sizes (Android 15+ devices)
target_link_options(reactnativempv PRIVATE -Wl,-z,max-page-size=16384)
