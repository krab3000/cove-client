/* config.h for building the module out of VLC's tree, against the VLC 3.0
 * Windows SDK with llvm-mingw (msvcrt, x86_64): what VLC's configure
 * defines for that target, for the headers and sources the module uses. */
#ifndef VLC_D3D11_HOST_CONFIG_H
#define VLC_D3D11_HOST_CONFIG_H

#define _WIN32_WINNT 0x0601 /* Windows 7 */
#define _WIN32_IE 0x0600
#define _UNICODE 1
#define UNICODE 1
#define VLC_WINSTORE_APP 0

#define HAVE_ID3D11VIDEODECODER 1
#define HAVE_D3D11_4_H 1

#define CAN_COMPILE_SSE2 1
#define CAN_COMPILE_SSE3 1
#define CAN_COMPILE_SSSE3 1

/* provided by mingw-w64 (vlc_fixups.h stands in for the rest) */
#define HAVE_MAX_ALIGN_T 1
#define HAVE_GETTIMEOFDAY 1
#define HAVE_LLDIV 1
#define HAVE_STRDUP 1
#define HAVE_STRNLEN 1
#define HAVE_STRCASECMP 1
#define HAVE_STRTOF 1
#define HAVE_STRTOLL 1
#define HAVE_ATOF 1
#define HAVE_ATOLL 1
#define HAVE_GETPID 1
#define HAVE_GETENV 1
#define HAVE_FSYNC 1
#define HAVE_SWAB 1
#define HAVE_REWIND 1
#define HAVE_NANF 1
#define HAVE_SINCOS 1
#define HAVE_STRUCT_TIMESPEC 1
#define HAVE_TIMESPEC_GET 1
#define HAVE_SEARCH_H 1
#define HAVE_INET_PTON 1
#define HAVE_STRUCT_POLLFD 1
#define HAVE_IF_NAMEINDEX 1
#define HAVE_STRUCT_IF_NAMEINDEX 1
#define HAVE_IF_NAMETOINDEX 1

#include <vlc_fixups.h>

#endif
