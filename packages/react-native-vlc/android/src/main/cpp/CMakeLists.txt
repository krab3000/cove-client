# librnvlcinput: libVLC's input from the app's byte cache (VlcInput.cpp). libVLC itself is reached at run time
# (dlopen of the libvlc.so libvlc-android loads), so nothing here links against it.
cmake_minimum_required(VERSION 3.13)
project(rnvlcinput CXX)

set(CMAKE_CXX_STANDARD 17)
add_library(rnvlcinput SHARED VlcInput.cpp)
target_compile_options(rnvlcinput PRIVATE -Wall -Wextra -fno-exceptions -fno-rtti)
target_link_libraries(rnvlcinput log dl)
target_link_options(rnvlcinput PRIVATE "-Wl,-z,max-page-size=16384")
