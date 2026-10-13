@echo off
rem Builds codecs.exe (codecs.cpp, react-native-mpv's cpp/ and its Windows HTTP sources) into ..\out\windows with
rem Visual Studio's x64 tools. Called by codecs.sh.
setlocal
set HERE=%~dp0
set PKG=%HERE%..\..\..\packages\react-native-mpv
set OUT=%HERE%..\out\windows
for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -prerelease -products * -property installationPath`) do set VS=%%i
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
if not exist "%OUT%" mkdir "%OUT%"
rem The package's Windows sources include RNW's "pch.h"; compiled from OUT they get a plain one.
(echo #pragma once& echo #define NOMINMAX& echo #define WIN32_LEAN_AND_MEAN& echo #include ^<windows.h^>) > "%OUT%\pch.h"
copy /y "%PKG%\windows\ReactNativeMpv\HttpAuth.cpp" "%OUT%" >nul
copy /y "%PKG%\windows\ReactNativeMpv\WinHttpFetcher.cpp" "%OUT%" >nul
cd /d "%OUT%"
cl /nologo /std:c++20 /EHsc /O2 /Zi /MD /W3 /DMPV_LOG_TO_STDERR /D_CRT_SECURE_NO_WARNINGS /I. /I"%PKG%\cpp" ^
  /I"%PKG%\windows\ReactNativeMpv" /I"%PKG%\third_party\mpv\win-x64\include" ^
  "%HERE%codecs.cpp" "%PKG%\cpp\*.cpp" HttpAuth.cpp WinHttpFetcher.cpp ^
  /Fe:codecs.exe /link /DEBUG d3d11.lib dxgi.lib winhttp.lib ole32.lib
