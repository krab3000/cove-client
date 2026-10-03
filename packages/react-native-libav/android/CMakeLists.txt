cmake_minimum_required(VERSION 3.22)
project(reactnativelibav CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The shared engine (../cpp) plus the Android sinks and the JNI bridge, against the prebuilt FFmpeg from
# scripts/ffmpeg-android (third_party/ffmpeg/android-<abi>).
set(ENGINE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../cpp)
set(FFMPEG_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../third_party/ffmpeg/android-${ANDROID_ABI})
if(NOT EXISTS ${FFMPEG_DIR}/include/libavcodec/avcodec.h)
  message(FATAL_ERROR "FFmpeg for Android not found in ${FFMPEG_DIR}. Run: yarn build-ffmpeg-android")
endif()

file(GLOB ENGINE_SOURCES ${ENGINE_DIR}/*.cpp)
add_library(reactnativelibav SHARED
  ${ENGINE_SOURCES}
  src/main/cpp/AAudioDevice.cpp
  src/main/cpp/AndroidVideoSink.cpp
  src/main/cpp/LibavJni.cpp)
target_include_directories(reactnativelibav PRIVATE ${ENGINE_DIR} src/main/cpp ${FFMPEG_DIR}/include)
target_compile_options(reactnativelibav PRIVATE -Wall -Wno-unknown-pragmas -fvisibility=hidden)

foreach(lib avformat avcodec avutil swresample swscale)
  add_library(${lib} SHARED IMPORTED)
  set_target_properties(${lib} PROPERTIES IMPORTED_LOCATION ${FFMPEG_DIR}/lib/lib${lib}.so)
  target_link_libraries(reactnativelibav ${lib})
endforeach()

target_link_libraries(reactnativelibav aaudio android log mediandk nativewindow)
# 16 KB page sizes (Android 15+ devices)
target_link_options(reactnativelibav PRIVATE -Wl,-z,max-page-size=16384)
