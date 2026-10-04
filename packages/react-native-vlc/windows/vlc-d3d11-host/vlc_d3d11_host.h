/*****************************************************************************
 * vlc_d3d11_host.h: render libVLC 3 video into a host-supplied Direct3D 11
 *                   render target (the d3d11_host video output module)
 *****************************************************************************
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *****************************************************************************/

/*
 * The d3d11_host module is VLC 3's Direct3D11 video output without a window or
 * a swapchain: the host application supplies the device and, per frame, the
 * render target view. VLC decodes on the host's device (D3D11VA decodes into
 * the output's picture pool), converts and scales the picture with its shaders
 * (HDR tone mapping included), blends subtitles over it and renders it into
 * the host's target. Frames never leave the GPU.
 *
 * The callbacks follow libVLC 4's libvlc_video_set_output_callbacks() for the
 * D3D11 engine, so a host written for one ports to the other.
 *
 * Usage, with libVLC 3:
 *   1. Load libd3d11_host_plugin.dll (from VLC's plugins/video_output folder)
 *      and get VLC_D3D11_HOST_ATTACH with GetProcAddress.
 *   2. Call it on a media player before playback, with callbacks that outlive
 *      the player. It selects this module as the player's video output.
 *      (Do not call libvlc_media_player_set_hwnd on that player: it selects
 *      the default outputs again.)
 *
 * Threads: all callbacks except report_size's target run on VLC's video
 * output thread. The host may call the report_size function from any thread,
 * between set_report_size calls that pass it and pass NULL.
 */

#ifndef VLC_D3D11_HOST_H
#define VLC_D3D11_HOST_H 1

#include <stdbool.h>
#include <stddef.h>
#include <d3d11.h>

#ifdef __cplusplus
extern "C" {
#endif

#define VLC_D3D11_HOST_VERSION 1

/* Name of the attach function exported by libd3d11_host_plugin.dll. */
#define VLC_D3D11_HOST_ATTACH "vlc_d3d11_host_attach"

/* Color values use the numbering of VLC's video_format_t (and libVLC 4's
 * libvlc_video_color_space_t, libvlc_video_color_primaries_t,
 * libvlc_video_transfer_func_t). */
enum
{
    VLC_D3D11_HOST_SPACE_BT601 = 1,
    VLC_D3D11_HOST_SPACE_BT709 = 2,
    VLC_D3D11_HOST_SPACE_BT2020 = 3,
};
enum
{
    VLC_D3D11_HOST_PRIMARIES_BT601_525 = 1,
    VLC_D3D11_HOST_PRIMARIES_BT601_625 = 2,
    VLC_D3D11_HOST_PRIMARIES_BT709 = 3,
    VLC_D3D11_HOST_PRIMARIES_BT2020 = 4,
    VLC_D3D11_HOST_PRIMARIES_DCI_P3 = 5,
};
enum
{
    VLC_D3D11_HOST_TRANSFER_LINEAR = 1,
    VLC_D3D11_HOST_TRANSFER_SRGB = 2,
    VLC_D3D11_HOST_TRANSFER_BT709 = 5,
    VLC_D3D11_HOST_TRANSFER_PQ = 6,
    VLC_D3D11_HOST_TRANSFER_HLG = 8,
};

typedef struct vlc_d3d11_host_device_t
{
    /* The immediate context of the device VLC decodes and renders on. VLC
     * holds a reference to it until cleanup. The device should be created
     * with D3D11_CREATE_DEVICE_VIDEO_SUPPORT for hardware decoding. */
    ID3D11DeviceContext *device_context;
    /* Optional: a Win32 mutex VLC holds while it uses the context; the host
     * holds it too around its own use. NULL when the host doesn't share the
     * context between threads. */
    HANDLE context_mutex;
} vlc_d3d11_host_device_t;

/* What VLC renders: the size of the target it asks for, and the source. */
typedef struct vlc_d3d11_host_render_cfg_t
{
    unsigned width;
    unsigned height;
    unsigned bitdepth;  /* of the source, per channel */
    bool full_range;
    int colorspace;     /* VLC_D3D11_HOST_SPACE_*, 0 when unknown */
    int primaries;      /* VLC_D3D11_HOST_PRIMARIES_*, 0 when unknown */
    int transfer;       /* VLC_D3D11_HOST_TRANSFER_*, 0 when unknown */
} vlc_d3d11_host_render_cfg_t;

/* What the host's render target is. VLC converts the video to it. */
typedef struct vlc_d3d11_host_output_cfg_t
{
    DXGI_FORMAT dxgi_format; /* e.g. DXGI_FORMAT_B8G8R8A8_UNORM */
    bool full_range;
    int colorspace;
    int primaries;
    int transfer;            /* SRGB: SDR (VLC tone maps HDR); PQ: HDR10 */
} vlc_d3d11_host_output_cfg_t;

typedef void (*vlc_d3d11_host_report_size_cb)(void *report_opaque,
                                              unsigned width, unsigned height);

typedef struct vlc_d3d11_host_callbacks_t
{
    unsigned version; /* VLC_D3D11_HOST_VERSION */
    void *opaque;     /* passed to every callback */

    /* A video output opens: return the device to use. */
    bool (*setup)(void *opaque, vlc_d3d11_host_device_t *out);
    /* The video output closed: VLC no longer uses the device. */
    void (*cleanup)(void *opaque);
    /* Gives the host the function it calls with the size, in pixels, of the
     * area the video is shown in (the size VLC renders at); NULL when the
     * output closes. The host may report a size right away. */
    void (*set_report_size)(void *opaque, vlc_d3d11_host_report_size_cb report,
                            void *report_opaque);
    /* VLC renders at a new size (or for the first time): the host makes a
     * render target of cfg's size and describes it in out. The output's
     * color description must stay the same until cleanup. */
    bool (*update_output)(void *opaque, const vlc_d3d11_host_render_cfg_t *cfg,
                          vlc_d3d11_host_output_cfg_t *out);
    /* Around the rendering of a frame (enter true, then false). */
    bool (*make_current)(void *opaque, bool enter);
    /* The render target view to render plane (0) of the frame into, at the
     * size of the last update_output. VLC fills all of it. */
    bool (*select_plane)(void *opaque, size_t plane,
                         ID3D11RenderTargetView **output);
    /* The last rendered frame is due on screen now. */
    void (*swap)(void *opaque);
} vlc_d3d11_host_callbacks_t;

/* Makes media_player (a libvlc_media_player_t *) render its video through
 * callbacks, or the default outputs again when callbacks is NULL. Returns 0
 * on success. Exported by libd3d11_host_plugin.dll as VLC_D3D11_HOST_ATTACH. */
typedef int (*vlc_d3d11_host_attach_fn)(void *media_player,
                                        const vlc_d3d11_host_callbacks_t *callbacks);

#ifdef __cplusplus
}
#endif

#endif /* VLC_D3D11_HOST_H */
