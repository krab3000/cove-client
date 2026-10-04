/*****************************************************************************
 * d3d11_host.c: Direct3D11 video output into a host-supplied render target
 *****************************************************************************
 * Derived from VLC 3.0's modules/video_output/win32/direct3d11.c:
 * Copyright (C) 2014-2015 VLC authors and VideoLAN
 *
 * Authors: Martell Malone <martellmalone@gmail.com>
 *          Steve Lhomme <robux4@gmail.com>
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston MA 02110-1301, USA.
 *****************************************************************************/

/*
 * VLC's Direct3D11 output without its window, event thread and swapchain: the
 * device and the per-frame render target come from the host through the
 * callbacks of vlc_d3d11_host.h. Everything else is direct3d11.c's: the
 * picture pool the D3D11VA decoder decodes into, the shaders (YUV to RGB,
 * scaling, HDR tone mapping, 360° projection) and the subpicture (subtitle,
 * OSD) blending. The Video Processor upscaler and the SDR to HDR tone mapper
 * are left out.
 */

#ifdef HAVE_CONFIG_H
# include "config.h"
#endif

#include <vlc_common.h>
#include <vlc_plugin.h>
#include <vlc_vout_display.h>

#include <assert.h>
#include <math.h>
#include <stdatomic.h>

#define COBJMACROS
#include <initguid.h>
#include <d3d11_1.h>
#ifdef HAVE_D3D11_4_H
#include <d3d11_4.h>
#endif

#include "video_chroma/d3d11_fmt.h"
#include "video_chroma/copy.h"
#include "video_output/win32/d3d11_quad.h"
#include "video_output/win32/d3d11_shaders.h"

#include "vlc_d3d11_host.h"

#define HOST_CALLBACKS_VAR "d3d11-host-callbacks"

static int  Open(vlc_object_t *);
static void Close(vlc_object_t *);

vlc_module_begin ()
    set_shortname("D3D11 host")
    set_description(N_("Direct3D11 video output into a host render target"))
    set_category(CAT_VIDEO)
    set_subcategory(SUBCAT_VIDEO_VOUT)

    /* only when selected (vlc_d3d11_host_attach) */
    set_capability("vout display", 0)
    set_callbacks(Open, Close)
vlc_module_end ()

/* Exported for hosts: see vlc_d3d11_host.h. */
__declspec(dllexport)
int vlc_d3d11_host_attach(void *media_player, const vlc_d3d11_host_callbacks_t *callbacks)
{
    vlc_object_t *player = media_player;
    if (player == NULL)
        return VLC_EGENERIC;
    if (callbacks != NULL && callbacks->version != VLC_D3D11_HOST_VERSION)
        return VLC_EGENERIC;

    /* the video output is a child of the media player: it inherits both */
    if (var_Type(player, HOST_CALLBACKS_VAR) == 0)
        var_Create(player, HOST_CALLBACKS_VAR, VLC_VAR_ADDRESS);
    var_SetAddress(player, HOST_CALLBACKS_VAR, (void *)callbacks);
    var_SetString(player, "vout", callbacks != NULL ? MODULE_STRING : "");
    return VLC_SUCCESS;
}

struct vout_display_sys_t
{
    const vlc_d3d11_host_callbacks_t *host;
    bool                     host_setup;     /* setup succeeded: cleanup is due */
    _Atomic uint64_t         host_size;      /* reported size: width << 32 | height */
    unsigned                 output_size[2]; /* size of the host's target (update_output) */
    bool                     rendered;       /* Prepare rendered a frame for Display */

    /* placement of the picture in the host's target */
    RECT                     rect_display;
    RECT                     rect_src;
    RECT                     rect_src_clipped;
    RECT                     rect_dest;
    RECT                     rect_dest_clipped;

    picture_pool_t           *pool;
    video_format_t           pool_fmt;
    const d3d_format_t       *pool_d3dfmt;

    int                      log_level;

    display_info_t           display;

    d3d11_handle_t           hd3d;
    d3d11_device_t           d3d_dev;
    d3d_quad_t               picQuad;
    video_format_t           quad_fmt;

#ifdef HAVE_D3D11_4_H
    ID3D11Fence              *d3dRenderFence;
    ID3D11DeviceContext4     *d3dcontext4;
    UINT64                   renderFence;
    HANDLE                   renderFinished;
#endif

    picture_sys_t            stagingSys;
    HANDLE                   sharedHandle;

    /* render states, set before each frame: the host uses the context too */
    ID3D11BlendState         *blendState;
    ID3D11DepthStencilState  *depthState;
    ID3D11SamplerState       *samplers[2];

    ID3D11InputLayout         *pVertexLayout;
    ID3D11VertexShader        *flatVSShader;
    ID3D11VertexShader        *projectionVSShader;

    /* copy from the decoder pool into picSquad before display
     * Uses a Texture2D with slices rather than a Texture2DArray for the decoder */
    bool                     legacy_shader;

    // SPU
    vlc_fourcc_t             pSubpictureChromas[2];
    ID3D11PixelShader        *pSPUPixelShader;
    const d3d_format_t       *d3dregion_format;
    int                      d3dregion_count;
    picture_t                **d3dregions;
};

#define RECTWidth(r)   (int)((r).right - (r).left)
#define RECTHeight(r)  (int)((r).bottom - (r).top)

static picture_pool_t *Pool(vout_display_t *, unsigned);

static void Prepare(vout_display_t *, picture_t *, subpicture_t *subpicture);
static void Display(vout_display_t *, picture_t *, subpicture_t *subpicture);

static int  Direct3D11Open (vout_display_t *);
static void Direct3D11Close(vout_display_t *);

static int SetupOutputFormat(vout_display_t *, video_format_t *decoder, video_format_t *quad);
static int  Direct3D11CreateFormatResources (vout_display_t *, const video_format_t *);
static int  Direct3D11CreateGenericResources(vout_display_t *);
static void Direct3D11DestroyResources(vout_display_t *);

static void DestroyDisplayPoolPicture(picture_t *);
static void Direct3D11DeleteRegions(int, picture_t **);
static int Direct3D11MapSubpicture(vout_display_t *, int *, picture_t ***, subpicture_t *);

static void SetQuadVSProjection(vout_display_t *, d3d_quad_t *, const vlc_viewpoint_t *);
static void UpdatePicQuadPosition(vout_display_t *);

static int Control(vout_display_t *, int, va_list);
static void Manage(vout_display_t *vd);

static int Direct3D11MapPoolTexture(picture_t *picture)
{
    picture_sys_t *p_sys = picture->p_sys;
    D3D11_MAPPED_SUBRESOURCE mappedResource;
    HRESULT hr;

#ifndef NDEBUG
    D3D11_TEXTURE2D_DESC dsc;
    ID3D11Texture2D_GetDesc(p_sys->texture[KNOWN_DXGI_INDEX], &dsc);
    assert(dsc.CPUAccessFlags & D3D11_CPU_ACCESS_WRITE);
    assert(dsc.Usage & D3D11_USAGE_DYNAMIC);
#endif

    hr = ID3D11DeviceContext_Map(p_sys->context, p_sys->resource[KNOWN_DXGI_INDEX], p_sys->slice_index, D3D11_MAP_WRITE_DISCARD, 0, &mappedResource);
    if( FAILED(hr) )
    {
        return VLC_EGENERIC;
    }
    return picture_UpdatePlanes(picture, mappedResource.pData, mappedResource.RowPitch);
}

static void Direct3D11UnmapPoolTexture(picture_t *picture)
{
    picture_sys_t *p_sys = picture->p_sys;
    ID3D11DeviceContext_Unmap(p_sys->context, p_sys->resource[KNOWN_DXGI_INDEX], 0);
}

/*****************************************************************************
 * Host
 *****************************************************************************/

static void ReportSize(void *opaque, unsigned width, unsigned height)
{
    vout_display_sys_t *sys = opaque;
    atomic_store(&sys->host_size, ((uint64_t)width << 32) | height);
}

/* The size of the area the host shows the video in, or the configured
 * display size until the host reports one. */
static void GetDisplaySize(vout_display_t *vd, const vout_display_cfg_t *cfg,
                           unsigned *width, unsigned *height)
{
    uint64_t size = atomic_load(&vd->sys->host_size);
    *width  = size >> 32;
    *height = size & 0xFFFFFFFF;
    if (*width == 0 || *height == 0)
    {
        *width  = __MAX(cfg->display.width, 1);
        *height = __MAX(cfg->display.height, 1);
    }
}

static int SourceBitDepth(const video_format_t *fmt)
{
    if (fmt->i_chroma == VLC_CODEC_D3D11_OPAQUE_10B)
        return 10;
    if (is_d3d11_opaque(fmt->i_chroma))
        return 8;
    const vlc_chroma_description_t *desc = vlc_fourcc_GetChromaDescription(fmt->i_chroma);
    if (desc == NULL || desc->pixel_bits == 0)
        return 8;
    return desc->pixel_bits / (desc->plane_count == 1 ? desc->pixel_size : 1);
}

#define COLOR_RANGE_FULL   1 /* 0-255 */
#define COLOR_RANGE_STUDIO 0 /* 16-235 */

#define TRANSFER_FUNC_10    TRANSFER_FUNC_LINEAR
#define TRANSFER_FUNC_22    TRANSFER_FUNC_SRGB
#define TRANSFER_FUNC_2084  TRANSFER_FUNC_SMPTE_ST2084

#define COLOR_PRIMARIES_BT601  COLOR_PRIMARIES_BT601_525

static const dxgi_color_space color_spaces[] = {
#define DXGIMAP(AXIS, RANGE, GAMMA, SITTING, PRIMARIES) \
    { DXGI_COLOR_SPACE_##AXIS##_##RANGE##_G##GAMMA##_##SITTING##_P##PRIMARIES, \
      #AXIS " Rec." #PRIMARIES " gamma:" #GAMMA " range:" #RANGE, \
      COLOR_AXIS_##AXIS, COLOR_PRIMARIES_BT##PRIMARIES, TRANSFER_FUNC_##GAMMA, \
      COLOR_SPACE_BT##PRIMARIES, COLOR_RANGE_##RANGE},

    DXGIMAP(RGB,   FULL,     22,    NONE,   709)
    DXGIMAP(RGB,   FULL,     10,    NONE,   709)
    DXGIMAP(RGB,   STUDIO,   22,    NONE,   709)
    DXGIMAP(RGB,   STUDIO,   22,    NONE,  2020)
    DXGIMAP(RGB,   FULL,     22,    NONE,  2020)
    DXGIMAP(RGB,   FULL,   2084,    NONE,  2020)
    DXGIMAP(RGB,   STUDIO, 2084,    NONE,  2020)
    {DXGI_COLOR_SPACE_RESERVED, NULL, 0, 0, 0, 0, 0},
#undef DXGIMAP
};

/* Asks the host for a render target of the display size, when it changed.
 * The first call also sets the display's color space from the host's answer. */
static int UpdateHostOutput(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;
    unsigned width, height;
    GetDisplaySize(vd, vd->cfg, &width, &height);
    if (sys->display.colorspace != NULL &&
        width == sys->output_size[0] && height == sys->output_size[1])
        return VLC_SUCCESS;

    const vlc_d3d11_host_render_cfg_t cfg = {
        .width      = width,
        .height     = height,
        .bitdepth   = SourceBitDepth(&vd->source),
        .full_range = vd->source.b_color_range_full,
        .colorspace = vd->source.space,
        .primaries  = vd->source.primaries,
        .transfer   = vd->source.transfer,
    };
    vlc_d3d11_host_output_cfg_t out = {
        .dxgi_format = DXGI_FORMAT_B8G8R8A8_UNORM,
        .full_range  = true,
        .colorspace  = VLC_D3D11_HOST_SPACE_BT709,
        .primaries   = VLC_D3D11_HOST_PRIMARIES_BT709,
        .transfer    = VLC_D3D11_HOST_TRANSFER_SRGB,
    };
    if (!sys->host->update_output(sys->host->opaque, &cfg, &out))
    {
        msg_Err(vd, "the host could not make a %ux%u render target", width, height);
        sys->output_size[0] = sys->output_size[1] = 0;
        return VLC_EGENERIC;
    }
    sys->output_size[0] = width;
    sys->output_size[1] = height;

    if (sys->display.colorspace == NULL)
    {
        const dxgi_color_space *csp = &color_spaces[0];
        for (int i = 0; color_spaces[i].name; ++i)
        {
            if (color_spaces[i].primaries == (video_color_primaries_t)out.primaries &&
                color_spaces[i].transfer == (video_transfer_func_t)out.transfer &&
                color_spaces[i].b_full_range == out.full_range)
            {
                csp = &color_spaces[i];
                break;
            }
        }
        sys->display.colorspace = csp;
        sys->display.luminance_peak = csp->transfer == TRANSFER_FUNC_SMPTE_ST2084 ?
                                      MAX_PQ_BRIGHTNESS : DEFAULT_SRGB_BRIGHTNESS;
        msg_Dbg(vd, "rendering in colorspace %s", csp->name);
    }
    return VLC_SUCCESS;
}

/*****************************************************************************
 * Open/Close
 *****************************************************************************/

static unsigned int GetPictureWidth(const vout_display_t *vd)
{
    return vd->sys->picQuad.i_width;
}

static unsigned int GetPictureHeight(const vout_display_t *vd)
{
    return vd->sys->picQuad.i_height;
}

static int Open(vlc_object_t *object)
{
    vout_display_t *vd = (vout_display_t *)object;

    const vlc_d3d11_host_callbacks_t *host = var_InheritAddress(vd, HOST_CALLBACKS_VAR);
    if (host == NULL || host->version != VLC_D3D11_HOST_VERSION)
        return VLC_EGENERIC;

    vout_display_sys_t *sys = vd->sys = calloc(1, sizeof(vout_display_sys_t));
    if (unlikely(sys == NULL))
        return VLC_ENOMEM;
    sys->host = host;
    atomic_init(&sys->host_size, 0);
    sys->sharedHandle = INVALID_HANDLE_VALUE;
    sys->d3d_dev.context_mutex = INVALID_HANDLE_VALUE;

    if (D3D11_Create(vd, &sys->hd3d, true) != VLC_SUCCESS)
        goto error;

    vlc_d3d11_host_device_t device = { 0 };
    if (!host->setup(host->opaque, &device) || device.device_context == NULL)
    {
        msg_Err(vd, "the host has no device");
        goto error;
    }
    sys->host_setup = true;

    sys->d3d_dev.d3dcontext = device.device_context;
    ID3D11DeviceContext_AddRef(sys->d3d_dev.d3dcontext);
    ID3D11DeviceContext_GetDevice(sys->d3d_dev.d3dcontext, &sys->d3d_dev.d3ddevice);
    sys->d3d_dev.feature_level = ID3D11Device_GetFeatureLevel(sys->d3d_dev.d3ddevice);
    sys->d3d_dev.owner = false;
    if (device.context_mutex != NULL)
    {
        sys->d3d_dev.context_mutex = device.context_mutex;
        /* how the decoder finds the mutex of the pool pictures' context */
        ID3D11DeviceContext_SetPrivateData(sys->d3d_dev.d3dcontext, &GUID_CONTEXT_MUTEX,
                                           sizeof(device.context_mutex), &device.context_mutex);
    }

    IDXGIAdapter *adap = D3D11DeviceAdapter(sys->d3d_dev.d3ddevice);
    if (adap == NULL || FAILED(IDXGIAdapter_GetDesc(adap, &sys->d3d_dev.adapterDesc)))
        msg_Warn(vd, "can't get adapter description");
    if (adap != NULL)
        IDXGIAdapter_Release(adap);
    D3D11_GetDriverVersion(vd, &sys->d3d_dev);

    host->set_report_size(host->opaque, ReportSize, sys);

    if (Direct3D11Open(vd)) {
        msg_Err(vd, "Direct3D11 could not be opened");
        goto error;
    }

    msg_Dbg(vd, "Direct3D11 device adapter successfully initialized");

    vd->info.has_pictures_invalid = vd->info.is_slow;

    if (sys->d3dregion_format != NULL)
    {
        sys->pSubpictureChromas[0] = sys->d3dregion_format->fourcc;
        sys->pSubpictureChromas[1] = 0;
        vd->info.subpicture_chromas = sys->pSubpictureChromas;
    }
    else
        vd->info.subpicture_chromas = NULL;

    vd->pool    = Pool;
    vd->prepare = Prepare;
    vd->display = Display;
    vd->control = Control;
    vd->manage  = Manage;

    msg_Dbg(vd, "Direct3D11 host output opened");

    return VLC_SUCCESS;

error:
    Close(object);
    return VLC_EGENERIC;
}

static void Close(vlc_object_t *object)
{
    vout_display_t * vd = (vout_display_t *)object;
    vout_display_sys_t *sys = vd->sys;

    if (sys->host_setup)
        sys->host->set_report_size(sys->host->opaque, NULL, NULL);
    Direct3D11Close(vd);
    if (sys->host_setup)
        sys->host->cleanup(sys->host->opaque);
    D3D11_Destroy(&sys->hd3d);
    free(sys);
}

static picture_pool_t *Pool(vout_display_t *vd, unsigned pool_size)
{
    /* compensate for extra hardware decoding pulling extra pictures from our pool */
    pool_size += 2;

    vout_display_sys_t *sys = vd->sys;
    picture_t **pictures = NULL;
    picture_t *picture;
    unsigned  picture_count = 0;

    if (sys->pool)
        return sys->pool;

    if (vd->info.is_slow)
        pool_size = 1;

    if (D3D11_SetupQuad( vd, &sys->d3d_dev, &sys->quad_fmt, &sys->picQuad, &sys->display, &sys->rect_src_clipped,
                   vd->fmt.projection_mode == PROJECTION_MODE_RECTANGULAR ? sys->flatVSShader : sys->projectionVSShader,
                   sys->pVertexLayout,
                   sys->quad_fmt.projection_mode, vd->fmt.orientation ) != VLC_SUCCESS) {
        msg_Err(vd, "Could not Create the main quad picture.");
        return NULL;
    }

    if ( vd->fmt.projection_mode == PROJECTION_MODE_EQUIRECTANGULAR ||
         vd->fmt.projection_mode == PROJECTION_MODE_CUBEMAP_LAYOUT_STANDARD )
        SetQuadVSProjection( vd, &sys->picQuad, &vd->cfg->viewpoint );

    if (!vd->info.is_slow) {
        HRESULT           hr;
        ID3D10Multithread *pMultithread;
        hr = ID3D11Device_QueryInterface( sys->d3d_dev.d3ddevice, &IID_ID3D10Multithread, (void **)&pMultithread);
        if (SUCCEEDED(hr)) {
            ID3D10Multithread_SetMultithreadProtected(pMultithread, TRUE);
            ID3D10Multithread_Release(pMultithread);
        }
    }

    if (sys->pool_d3dfmt->formatTexture == DXGI_FORMAT_UNKNOWN)
        sys->pool = picture_pool_NewFromFormat( &sys->pool_fmt, pool_size );
    else
    {
        ID3D11Texture2D  *textures[pool_size * D3D11_MAX_SHADER_VIEW];
        memset(textures, 0, sizeof(textures));
        unsigned slices = pool_size;
        if (!CanUseVoutPool(&sys->d3d_dev, pool_size))
            /* only provide enough for the filters, we can still do direct rendering */
            slices = __MIN(slices, 6);

        if (AllocateTextures(vd, &sys->d3d_dev, sys->pool_d3dfmt, &sys->pool_fmt, true, false, slices, textures))
            goto error;

        pictures = calloc(pool_size, sizeof(*pictures));
        if (!pictures)
            goto error;

        for (picture_count = 0; picture_count < pool_size; picture_count++) {
            picture_sys_t *picsys = calloc(1, sizeof(*picsys));
            if (unlikely(picsys == NULL))
                goto error;

            for (unsigned plane = 0; plane < D3D11_MAX_SHADER_VIEW; plane++)
            {
                if (picture_count < slices)
                    picsys->texture[plane] =textures[picture_count * D3D11_MAX_SHADER_VIEW + plane];
                else if (textures[plane])
                {
                    picsys->texture[plane] = textures[plane];
                    ID3D11Texture2D_AddRef(picsys->texture[plane]);
                }
            }

            picsys->slice_index = picture_count < slices ? picture_count : 0;
            picsys->formatTexture = sys->pool_d3dfmt->formatTexture;
            picsys->context = sys->d3d_dev.d3dcontext;

            picture_resource_t resource = {
                .p_sys = picsys,
                .pf_destroy = DestroyDisplayPoolPicture,
            };

            picture = picture_NewFromResource(&sys->pool_fmt, &resource);
            if (unlikely(picture == NULL)) {
                free(picsys);
                msg_Err( vd, "Failed to create picture %d in the pool.", picture_count );
                goto error;
            }

            pictures[picture_count] = picture;
            /* each picture_t holds a ref to the context and release it on Destroy */
            ID3D11DeviceContext_AddRef(picsys->context);
        }

        if (is_d3d11_opaque(sys->pool_fmt.i_chroma) && !sys->legacy_shader)
        {
            sys->picQuad.resourceCount = DxgiResourceCount(sys->pool_d3dfmt);
            for (picture_count = 0; picture_count < slices; picture_count++) {
                if (!pictures[picture_count]->p_sys->texture[0])
                    continue;
                if (D3D11_AllocateShaderView(vd, sys->d3d_dev.d3ddevice, sys->pool_d3dfmt,
                                       pictures[picture_count]->p_sys->texture, picture_count,
                                       pictures[picture_count]->p_sys->resourceView))
                    goto error;
            }
        }

        picture_pool_configuration_t pool_cfg = {
            .picture       = pictures,
            .picture_count = pool_size,
        };
        if (vd->info.is_slow && !is_d3d11_opaque(sys->pool_fmt.i_chroma)) {
            pool_cfg.lock          = Direct3D11MapPoolTexture;
            //pool_cfg.unlock        = Direct3D11UnmapPoolTexture;
        }
        sys->pool = picture_pool_NewExtended( &pool_cfg );
    }

error:
    if (sys->pool == NULL) {
        picture_pool_configuration_t pool_cfg = {
            .picture_count = 0,
        };
        if (pictures) {
            msg_Dbg(vd, "Failed to create the picture d3d11 pool");
            for (unsigned i=0;i<picture_count; ++i)
                picture_Release(pictures[i]);
            free(pictures);
        }

        /* create an empty pool to avoid crashing */
        sys->pool = picture_pool_NewExtended( &pool_cfg );
    } else {
        msg_Dbg(vd, "D3D11 pool succeed with %d surfaces (%dx%d) context 0x%p",
                pool_size, sys->pool_fmt.i_width, sys->pool_fmt.i_height, sys->d3d_dev.d3dcontext);
    }
    return sys->pool;
}

static void DestroyDisplayPoolPicture(picture_t *picture)
{
    picture_sys_t *p_sys = picture->p_sys;
    ReleasePictureSys( p_sys );
    free(p_sys);
    free(picture);
}

static int CreateRenderStates(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;
    HRESULT hr;

    D3D11_SAMPLER_DESC sampDesc;
    memset(&sampDesc, 0, sizeof(sampDesc));
    sampDesc.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampDesc.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampDesc.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    sampDesc.ComparisonFunc = D3D11_COMPARISON_ALWAYS;
    sampDesc.MinLOD = 0;
    sampDesc.MaxLOD = D3D11_FLOAT32_MAX;

    sampDesc.Filter = D3D11_FILTER_MIN_MAG_LINEAR_MIP_POINT;
    hr = ID3D11Device_CreateSamplerState(sys->d3d_dev.d3ddevice, &sampDesc, &sys->samplers[0]);
    if (FAILED(hr)) {
        msg_Err(vd, "Could not Create the D3d11 Sampler State. (hr=0x%lX)", hr);
        return VLC_EGENERIC;
    }

    sampDesc.Filter = D3D11_FILTER_MIN_MAG_MIP_POINT;
    hr = ID3D11Device_CreateSamplerState(sys->d3d_dev.d3ddevice, &sampDesc, &sys->samplers[1]);
    if (FAILED(hr)) {
        msg_Err(vd, "Could not Create the D3d11 Sampler State. (hr=0x%lX)", hr);
        return VLC_EGENERIC;
    }

    D3D11_BLEND_DESC spuBlendDesc = { 0 };
    spuBlendDesc.RenderTarget[0].BlendEnable = TRUE;
    spuBlendDesc.RenderTarget[0].SrcBlend = D3D11_BLEND_SRC_ALPHA;
    spuBlendDesc.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
    spuBlendDesc.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;

    spuBlendDesc.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
    spuBlendDesc.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_ZERO;
    spuBlendDesc.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;

    spuBlendDesc.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;

    spuBlendDesc.RenderTarget[1].BlendEnable = TRUE;
    spuBlendDesc.RenderTarget[1].SrcBlend = D3D11_BLEND_ONE;
    spuBlendDesc.RenderTarget[1].DestBlend = D3D11_BLEND_ZERO;
    spuBlendDesc.RenderTarget[1].BlendOp = D3D11_BLEND_OP_ADD;

    spuBlendDesc.RenderTarget[1].SrcBlendAlpha = D3D11_BLEND_ONE;
    spuBlendDesc.RenderTarget[1].DestBlendAlpha = D3D11_BLEND_ZERO;
    spuBlendDesc.RenderTarget[1].BlendOpAlpha = D3D11_BLEND_OP_ADD;

    spuBlendDesc.RenderTarget[1].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    hr = ID3D11Device_CreateBlendState(sys->d3d_dev.d3ddevice, &spuBlendDesc, &sys->blendState);
    if (FAILED(hr)) {
       msg_Err(vd, "Could not create SPU blend state. (hr=0x%lX)", hr);
       return VLC_EGENERIC;
    }

    /* disable depth testing as we're only doing 2D
     * see https://msdn.microsoft.com/en-us/library/windows/desktop/bb205074%28v=vs.85%29.aspx
     * see http://rastertek.com/dx11tut11.html
    */
    D3D11_DEPTH_STENCIL_DESC stencilDesc;
    ZeroMemory(&stencilDesc, sizeof(stencilDesc));
    hr = ID3D11Device_CreateDepthStencilState(sys->d3d_dev.d3ddevice, &stencilDesc, &sys->depthState);
    if (FAILED(hr))
        sys->depthState = NULL;

    return VLC_SUCCESS;
}

static void SetRenderStates(vout_display_sys_t *sys)
{
    ID3D11DeviceContext *ctx = sys->d3d_dev.d3dcontext;
    ID3D11DeviceContext_OMSetBlendState(ctx, sys->blendState, NULL, 0xFFFFFFFF);
    if (sys->depthState)
        ID3D11DeviceContext_OMSetDepthStencilState(ctx, sys->depthState, 0);
    ID3D11DeviceContext_PSSetSamplers(ctx, 0, 2, sys->samplers);
    ID3D11DeviceContext_RSSetState(ctx, NULL);
}

/* rotation around the Z axis */
static void getZRotMatrix(float theta, FLOAT matrix[static 16])
{
    float st, ct;

    sincosf(theta, &st, &ct);

    const FLOAT m[] = {
    /*  x    y    z    w */
        ct,  -st, 0.f, 0.f,
        st,  ct,  0.f, 0.f,
        0.f, 0.f, 1.f, 0.f,
        0.f, 0.f, 0.f, 1.f
    };

    memcpy(matrix, m, sizeof(m));
}

/* rotation around the Y axis */
static void getYRotMatrix(float theta, FLOAT matrix[static 16])
{
    float st, ct;

    sincosf(theta, &st, &ct);

    const FLOAT m[] = {
    /*  x    y    z    w */
        ct,  0.f, -st, 0.f,
        0.f, 1.f, 0.f, 0.f,
        st,  0.f, ct,  0.f,
        0.f, 0.f, 0.f, 1.f
    };

    memcpy(matrix, m, sizeof(m));
}

/* rotation around the X axis */
static void getXRotMatrix(float phi, FLOAT matrix[static 16])
{
    float sp, cp;

    sincosf(phi, &sp, &cp);

    const FLOAT m[] = {
    /*  x    y    z    w */
        1.f, 0.f, 0.f, 0.f,
        0.f, cp,  sp,  0.f,
        0.f, -sp, cp,  0.f,
        0.f, 0.f, 0.f, 1.f
    };

    memcpy(matrix, m, sizeof(m));
}

static void getZoomMatrix(float zoom, FLOAT matrix[static 16]) {

    const FLOAT m[] = {
        /* x   y     z     w */
        1.0f, 0.0f, 0.0f, 0.0f,
        0.0f, 1.0f, 0.0f, 0.0f,
        0.0f, 0.0f, 1.0f, 0.0f,
        0.0f, 0.0f, zoom, 1.0f
    };

    memcpy(matrix, m, sizeof(m));
}

/* perspective matrix see https://www.opengl.org/sdk/docs/man2/xhtml/gluPerspective.xml */
static void getProjectionMatrix(float sar, float fovy, FLOAT matrix[static 16]) {

    float zFar  = 1000;
    float zNear = 0.01;

    float f = 1.f / tanf(fovy / 2.f);

    const FLOAT m[] = {
        f / sar, 0.f,                   0.f,                0.f,
        0.f,     f,                     0.f,                0.f,
        0.f,     0.f,     (zNear + zFar) / (zNear - zFar), -1.f,
        0.f,     0.f, (2 * zNear * zFar) / (zNear - zFar),  0.f};

     memcpy(matrix, m, sizeof(m));
}

static float UpdateFOVy(float f_fovx, float f_sar)
{
    return 2 * atanf(tanf(f_fovx / 2) / f_sar);
}

static float UpdateZ(float f_fovx, float f_fovy)
{
    /* Do trigonometry to calculate the minimal z value
     * that will allow us to zoom out without seeing the outside of the
     * sphere (black borders). */
    float tan_fovx_2 = tanf(f_fovx / 2);
    float tan_fovy_2 = tanf(f_fovy / 2);
    float z_min = - SPHERE_RADIUS / sinf(atanf(sqrtf(
                    tan_fovx_2 * tan_fovx_2 + tan_fovy_2 * tan_fovy_2)));

    /* The FOV value above which z is dynamically calculated. */
    const float z_thresh = 90.f;

    float f_z;
    if (f_fovx <= z_thresh * M_PI / 180)
        f_z = 0;
    else
    {
        float f = z_min / ((FIELD_OF_VIEW_DEGREES_MAX - z_thresh) * M_PI / 180);
        f_z = f * f_fovx - f * z_thresh * M_PI / 180;
        if (f_z < z_min)
            f_z = z_min;
    }
    return f_z;
}

static void SetQuadVSProjection(vout_display_t *vd, d3d_quad_t *quad, const vlc_viewpoint_t *p_vp)
{
    if (!quad->pVertexShaderConstants)
        return;

#define RAD(d) ((float) ((d) * M_PI / 180.f))
    float f_fovx = RAD(p_vp->fov);
    if ( f_fovx > FIELD_OF_VIEW_DEGREES_MAX * M_PI / 180 + 0.001f ||
         f_fovx < -0.001f )
        return;

    float f_sar = (float) vd->cfg->display.width / vd->cfg->display.height;
    float f_teta = RAD(p_vp->yaw) - (float) M_PI_2;
    float f_phi  = RAD(p_vp->pitch);
    float f_roll = RAD(p_vp->roll);
    float f_fovy = UpdateFOVy(f_fovx, f_sar);
    float f_z = UpdateZ(f_fovx, f_fovy);

    vout_display_sys_t *sys = vd->sys;
    HRESULT hr;
    D3D11_MAPPED_SUBRESOURCE mapped;
    d3d11_device_lock( &sys->d3d_dev );
    hr = ID3D11DeviceContext_Map(sys->d3d_dev.d3dcontext, (ID3D11Resource *)quad->pVertexShaderConstants, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
    if (SUCCEEDED(hr)) {
        VS_PROJECTION_CONST *dst_data = mapped.pData;
        getXRotMatrix(f_phi, dst_data->RotX);
        getYRotMatrix(f_teta,   dst_data->RotY);
        getZRotMatrix(f_roll,  dst_data->RotZ);
        getZoomMatrix(SPHERE_RADIUS * f_z, dst_data->View);
        getProjectionMatrix(f_sar, f_fovy, dst_data->Projection);
        ID3D11DeviceContext_Unmap(sys->d3d_dev.d3dcontext, (ID3D11Resource *)quad->pVertexShaderConstants, 0);
    }
    d3d11_device_unlock( &sys->d3d_dev );
#undef RAD
}

/*****************************************************************************
 * Placement (from win32/common.c, external rendering)
 *****************************************************************************/

static void UpdateRects(vout_display_t *vd, const vout_display_cfg_t *cfg, bool is_forced)
{
    vout_display_sys_t *sys = vd->sys;
    const video_format_t *source = &vd->source;

    if (!cfg)
        cfg = vd->cfg;

    unsigned window_width, window_height;
    GetDisplaySize(vd, cfg, &window_width, &window_height);

    bool is_resized =
        window_width  != (UINT)RECTWidth(sys->rect_display) ||
        window_height != (UINT)RECTHeight(sys->rect_display);
    sys->rect_display.left = 0;
    sys->rect_display.top = 0;
    sys->rect_display.right = window_width;
    sys->rect_display.bottom = window_height;

    if (is_resized)
        vout_display_SendEventDisplaySize(vd, window_width, window_height);
    if (!is_forced && !is_resized)
        return;

    /* Update the window position and size */
    vout_display_cfg_t place_cfg = *cfg;
    place_cfg.display.width = window_width;
    place_cfg.display.height = window_height;

    vout_display_place_t place;
    vout_display_PlacePicture(&place, source, &place_cfg, false);

    /* Destination image position and dimensions */
    sys->rect_dest.left = place.x;
    sys->rect_dest.right = sys->rect_dest.left + place.width;
    sys->rect_dest.top = place.y;
    sys->rect_dest.bottom = sys->rect_dest.top + place.height;

    /* AFAIK, there are no clipping constraints in Direct3D */
    sys->rect_dest_clipped = sys->rect_dest;

    if (RECTWidth(sys->rect_dest_clipped) == 0 || RECTHeight(sys->rect_dest_clipped) == 0) {
        sys->rect_src_clipped = (RECT){0, 0, 0, 0};
        return;
    }

    /* src image dimensions */
    sys->rect_src.left = 0;
    sys->rect_src.top = 0;
    sys->rect_src.right = GetPictureWidth(vd);
    sys->rect_src.bottom = GetPictureHeight(vd);

    /* the whole visible source: the destination is not clipped */
    sys->rect_src_clipped.left = source->i_x_offset;
    sys->rect_src_clipped.right = source->i_x_offset + source->i_visible_width;
    sys->rect_src_clipped.top = source->i_y_offset;
    sys->rect_src_clipped.bottom = source->i_y_offset + source->i_visible_height;
}

static void UpdateSize(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;
    msg_Dbg(vd, "Detected size change %dx%d", RECTWidth(sys->rect_dest_clipped),
            RECTHeight(sys->rect_dest_clipped));

    UpdateHostOutput(vd);

    d3d11_device_lock( &sys->d3d_dev );

    UpdatePicQuadPosition(vd);

    D3D11_UpdateQuadPosition(vd, &sys->d3d_dev, &sys->picQuad, &sys->rect_src_clipped,
                             vd->fmt.orientation);

    d3d11_device_unlock( &sys->d3d_dev );
}

static inline bool RectEquals(const RECT *r1, const RECT *r2)
{
    return r1->bottom == r2->bottom && r1->top == r2->top &&
           r1->left == r2->left && r1->right == r2->right;
}

static int Control(vout_display_t *vd, int query, va_list args)
{
    vout_display_sys_t *sys = vd->sys;
    RECT before_src_clipped  = sys->rect_src_clipped;
    RECT before_dest_clipped = sys->rect_dest_clipped;
    RECT before_dest         = sys->rect_dest;
    int res = VLC_EGENERIC;

    switch (query) {
    case VOUT_DISPLAY_CHANGE_DISPLAY_SIZE:
    {
        /* the host decides the size: accept only the one it reported */
        const vout_display_cfg_t *cfg = va_arg(args, const vout_display_cfg_t *);
        unsigned width, height;
        GetDisplaySize(vd, cfg, &width, &height);
        if (cfg->display.width != width || cfg->display.height != height)
            return VLC_EGENERIC;
        UpdateRects(vd, cfg, true);
        res = VLC_SUCCESS;
        break;
    }
    case VOUT_DISPLAY_CHANGE_DISPLAY_FILLED: /* const vout_display_cfg_t *p_cfg */
    case VOUT_DISPLAY_CHANGE_ZOOM:           /* const vout_display_cfg_t *p_cfg */
    case VOUT_DISPLAY_CHANGE_SOURCE_ASPECT:
    case VOUT_DISPLAY_CHANGE_SOURCE_CROP: {
        const vout_display_cfg_t *cfg;

        if (query == VOUT_DISPLAY_CHANGE_SOURCE_CROP ||
            query == VOUT_DISPLAY_CHANGE_SOURCE_ASPECT) {
            cfg    = vd->cfg;
        } else {
            cfg    = va_arg(args, const vout_display_cfg_t *);
        }
        UpdateRects(vd, cfg, true);
        res = VLC_SUCCESS;
        break;
    }
    case VOUT_DISPLAY_CHANGE_VIEWPOINT:
    {
        const vout_display_cfg_t *cfg = va_arg(args, const vout_display_cfg_t*);
        if ( sys->picQuad.pVertexShaderConstants )
        {
            SetQuadVSProjection( vd, &sys->picQuad, &cfg->viewpoint );
            res = VLC_SUCCESS;
        }
        break;
    }
    default:
        /* no window: no fullscreen, window state or picture reset */
        return VLC_EGENERIC;
    }

    if (!RectEquals(&before_src_clipped,  &sys->rect_src_clipped) ||
        !RectEquals(&before_dest_clipped, &sys->rect_dest_clipped) ||
        !RectEquals(&before_dest,         &sys->rect_dest) )
    {
        UpdateSize(vd);
    }

    return res;
}

static void Manage(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;
    RECT before_src_clipped  = sys->rect_src_clipped;
    RECT before_dest_clipped = sys->rect_dest_clipped;
    RECT before_dest         = sys->rect_dest;

    /* picks up the size the host reported */
    UpdateRects(vd, NULL, false);

    if (!RectEquals(&before_src_clipped, &sys->rect_src_clipped) ||
        !RectEquals(&before_dest_clipped, &sys->rect_dest_clipped) ||
        !RectEquals(&before_dest, &sys->rect_dest))
    {
        UpdateSize(vd);
    }
}

static int CreateStaging(vout_display_t *vd, ID3D11DeviceContext *shared_context)
{
    vout_display_sys_t *sys = vd->sys;
    ID3D11Texture2D *textures[D3D11_MAX_SHADER_VIEW] = {0};
    video_format_t surface_fmt = sys->pool_fmt;
    surface_fmt.i_width  = sys->picQuad.i_width;
    surface_fmt.i_height = sys->picQuad.i_height;

    if (AllocateTextures(vd, &sys->d3d_dev, sys->picQuad.formatInfo, &surface_fmt,
                         false, shared_context != NULL, 1, textures))
    {
        msg_Err(vd, "Failed to allocate the staging texture");
        return VLC_EGENERIC;
    }

    sys->picQuad.resourceCount = DxgiResourceCount(sys->picQuad.formatInfo);
    if (D3D11_AllocateShaderView(vd, sys->d3d_dev.d3ddevice, sys->picQuad.formatInfo,
                                 textures, 0, sys->stagingSys.resourceView))
    {
        msg_Err(vd, "Failed to allocate the staging shader view");
        return VLC_EGENERIC;
    }

    for (unsigned plane = 0; plane < D3D11_MAX_SHADER_VIEW; plane++)
        sys->stagingSys.texture[plane] = textures[plane];


    if (shared_context)
    {
        assert(sys->sharedHandle == INVALID_HANDLE_VALUE);
        HRESULT hr;
        IDXGIResource1* sharedResource = NULL;
        ID3D11Resource_QueryInterface(sys->stagingSys.resource[0], &IID_IDXGIResource1, (void**)&sharedResource);
        hr = IDXGIResource1_CreateSharedHandle(sharedResource, NULL, DXGI_SHARED_RESOURCE_READ|DXGI_SHARED_RESOURCE_WRITE, NULL, &sys->sharedHandle);
        IDXGIResource1_Release(sharedResource);
        if (FAILED(hr))
        {
            msg_Err(vd, "Failed to get the shared handle");
            return VLC_EGENERIC;
        }
    }

    return VLC_SUCCESS;
}

/* Uploads or copies the picture for the shaders, then renders it with its
 * subpictures into the host's target. */
static void Prepare(vout_display_t *vd, picture_t *picture, subpicture_t *subpicture)
{
    vout_display_sys_t *sys = vd->sys;
    sys->rendered = false;

    /* the host's context: always under its lock, also for CPU pictures */
    d3d11_device_lock( &sys->d3d_dev );

    if (sys->picQuad.formatInfo->formatTexture == DXGI_FORMAT_UNKNOWN)
    {
        D3D11_MAPPED_SUBRESOURCE mappedResource;
        D3D11_TEXTURE2D_DESC texDesc;
        int i;
        HRESULT hr;
        plane_t planes[PICTURE_PLANE_MAX];

        bool b_mapped = true;
        for (i = 0; i < picture->i_planes; i++) {
            hr = ID3D11DeviceContext_Map(sys->d3d_dev.d3dcontext, sys->stagingSys.resource[i],
                                         0, D3D11_MAP_WRITE_DISCARD, 0, &mappedResource);
            if( unlikely(FAILED(hr)) )
            {
                while (i-- > 0)
                    ID3D11DeviceContext_Unmap(sys->d3d_dev.d3dcontext, sys->stagingSys.resource[i], 0);
                b_mapped = false;
                break;
            }
            ID3D11Texture2D_GetDesc(sys->stagingSys.texture[i], &texDesc);
            planes[i].i_lines = texDesc.Height;
            planes[i].i_pitch = mappedResource.RowPitch;
            planes[i].p_pixels = mappedResource.pData;

            planes[i].i_visible_lines = picture->p[i].i_visible_lines;
            planes[i].i_visible_pitch = picture->p[i].i_visible_pitch;
        }

        if (b_mapped)
        {
            for (i = 0; i < picture->i_planes; i++)
                plane_CopyPixels(&planes[i], &picture->p[i]);

            for (i = 0; i < picture->i_planes; i++)
                ID3D11DeviceContext_Unmap(sys->d3d_dev.d3dcontext, sys->stagingSys.resource[i], 0);
        }
    }
    else
    {
        picture_sys_t *p_sys = ActivePictureSys(picture);

        D3D11_TEXTURE2D_DESC srcDesc;
        ID3D11Texture2D_GetDesc(p_sys->texture[KNOWN_DXGI_INDEX], &srcDesc);

        ID3D11DeviceContext* copyContext = sys->d3d_dev.d3dcontext;
        ID3D11Resource* copyResource = sys->stagingSys.resource[KNOWN_DXGI_INDEX];
        ID3D11Resource* newResource = NULL;

        if (is_d3d11_opaque(picture->format.i_chroma) && sys->d3d_dev.d3dcontext != p_sys->context)
        {
            /* decoded on another device: through a shared texture */
            if (sys->stagingSys.texture[0] == NULL)
            {
                sys->legacy_shader = true; // force using staging
                int ret = CreateStaging(vd, p_sys->context);
                if (unlikely(ret != VLC_SUCCESS))
                    goto done;
            }

            HRESULT hr;

            ID3D11Device *psysDev;
            ID3D11Device1 *d3d11VLC1;
            ID3D11DeviceContext_GetDevice(p_sys->context, &psysDev);
            hr = ID3D11Device_QueryInterface(psysDev, &IID_ID3D11Device1, (void**)&d3d11VLC1);
            if (SUCCEEDED(hr))
            {
                hr = ID3D11Device1_OpenSharedResource1(d3d11VLC1, sys->sharedHandle, &IID_ID3D11Resource, (void**)&newResource);
                ID3D11Device1_Release(d3d11VLC1);
            }
            ID3D11Device_Release(psysDev);
            if (FAILED(hr))
                goto done;

            copyResource = newResource;
            copyContext = p_sys->context;
        }

        if (!is_d3d11_opaque(picture->format.i_chroma) || sys->legacy_shader) {
            D3D11_TEXTURE2D_DESC texDesc;
            if (!is_d3d11_opaque(picture->format.i_chroma))
                Direct3D11UnmapPoolTexture(picture);
            ID3D11Texture2D_GetDesc(sys->stagingSys.texture[0], &texDesc);
            D3D11_BOX box = {
                .top = 0,
                .bottom = __MIN(srcDesc.Height, texDesc.Height),
                .left = 0,
                .right = __MIN(srcDesc.Width, texDesc.Width),
                .back = 1,
            };
            ID3D11DeviceContext_CopySubresourceRegion(copyContext,
                                                      copyResource,
                                                      0, 0, 0, 0,
                                                      p_sys->resource[KNOWN_DXGI_INDEX],
                                                      p_sys->slice_index, &box);
        }
        else
        {
            if (srcDesc.BindFlags & D3D11_BIND_SHADER_RESOURCE)
            {
                /* for performance reason we don't want to allocate this during
                 * display, do it preferrably when creating the texture */
                assert(p_sys->resourceView[0]!=NULL);
            }
            if ( sys->picQuad.i_height != srcDesc.Height ||
                 sys->picQuad.i_width != srcDesc.Width )
            {
                /* the decoder produced different sizes than the vout, we need to
                 * adjust the vertex */
                sys->quad_fmt.i_width = srcDesc.Width;
                sys->quad_fmt.i_height = srcDesc.Height;
                sys->picQuad.i_width = sys->quad_fmt.i_width;
                sys->picQuad.i_height = sys->quad_fmt.i_height;

                UpdateRects(vd, NULL, true);
                UpdateSize(vd);
            }
        }

        if (newResource != NULL)
            // shared resource
            ID3D11Resource_Release(newResource);
    }

    if (subpicture) {
        int subpicture_region_count    = 0;
        picture_t **subpicture_regions = NULL;
        Direct3D11MapSubpicture(vd, &subpicture_region_count, &subpicture_regions, subpicture);
        Direct3D11DeleteRegions(sys->d3dregion_count, sys->d3dregions);
        sys->d3dregion_count = subpicture_region_count;
        sys->d3dregions      = subpicture_regions;
    }

    if (picture->format.mastering.max_luminance)
    {
        D3D11_UpdateQuadLuminanceScale(vd, &sys->d3d_dev, &sys->picQuad, (float)sys->display.luminance_peak / GetFormatLuminance(VLC_OBJECT(vd), &picture->format));
    }

    if (sys->output_size[0] == 0 && UpdateHostOutput(vd) != VLC_SUCCESS)
        goto done;

    if (!sys->host->make_current(sys->host->opaque, true))
        goto done;
    ID3D11RenderTargetView *renderTarget = NULL;
    if (!sys->host->select_plane(sys->host->opaque, 0, &renderTarget) || renderTarget == NULL)
    {
        sys->host->make_current(sys->host->opaque, false);
        goto done;
    }

    SetRenderStates(sys);

    FLOAT blackRGBA[4] = {0.0f, 0.0f, 0.0f, 1.0f};
    ID3D11DeviceContext_ClearRenderTargetView(sys->d3d_dev.d3dcontext, renderTarget, blackRGBA);

    ID3D11ShaderResourceView *SRV[D3D11_MAX_SHADER_VIEW];
    /* Render the quad using the last stage of processing */
    if (!is_d3d11_opaque(picture->format.i_chroma) || sys->legacy_shader)
    {
        memcpy(SRV, sys->stagingSys.resourceView, sizeof(SRV));
    }
    else
    {
        picture_sys_t *p_sys;
        p_sys = ActivePictureSys(picture);
        memcpy(SRV, p_sys->resourceView, sizeof(SRV));
    }
    D3D11_RenderQuad(&sys->d3d_dev, &sys->picQuad, SRV, renderTarget);

    if (subpicture) {
        // draw the additional vertices
        for (int i = 0; i < sys->d3dregion_count; ++i) {
            if (sys->d3dregions[i])
            {
                d3d_quad_t *quad = (d3d_quad_t *) sys->d3dregions[i]->p_sys;
                D3D11_RenderQuad(&sys->d3d_dev, quad, quad->picSys.resourceView, renderTarget);
            }
        }
    }

    /* leave no binding of the host's target behind */
    ID3D11RenderTargetView *noTarget = NULL;
    ID3D11DeviceContext_OMSetRenderTargets(sys->d3d_dev.d3dcontext, 1, &noTarget, NULL);

    sys->host->make_current(sys->host->opaque, false);
    sys->rendered = true;

#ifdef HAVE_D3D11_4_H
    if (sys->d3dcontext4)
    {
        if (sys->renderFence == UINT64_MAX)
            sys->renderFence = 0;
        else
            sys->renderFence++;

        ResetEvent(sys->renderFinished);
        ID3D11Fence_SetEventOnCompletion(sys->d3dRenderFence, sys->renderFence, sys->renderFinished);
        ID3D11DeviceContext4_Signal(sys->d3dcontext4, sys->d3dRenderFence, sys->renderFence);
    }
#endif

done:
    d3d11_device_unlock( &sys->d3d_dev );

#ifdef HAVE_D3D11_4_H
    /* the frame is ready on the GPU before its display date (outside the
     * lock: the host can use the context meanwhile) */
    if (sys->rendered && sys->d3dcontext4)
    {
        vlc_tick_t render_start;
        if (sys->log_level >= 4)
            render_start = mdate();
        WaitForSingleObject(sys->renderFinished, INFINITE);
        if (sys->log_level >= 4)
            msg_Dbg(vd, "waited %" PRId64 " ms for the render fence",
                    (mdate() - render_start) * 1000 / CLOCK_FREQ);
    }
#endif
}

static void Display(vout_display_t *vd, picture_t *picture, subpicture_t *subpicture)
{
    vout_display_sys_t *sys = vd->sys;

    if (sys->rendered)
        sys->host->swap(sys->host->opaque);
    sys->rendered = false;

    picture_Release(picture);
    if (subpicture)
        subpicture_Delete(subpicture);
}

static const d3d_format_t *GetDirectRenderingFormat(vout_display_t *vd, vlc_fourcc_t i_src_chroma)
{
    UINT supportFlags = D3D11_FORMAT_SUPPORT_SHADER_LOAD;
    if (is_d3d11_opaque(i_src_chroma))
        supportFlags |= D3D11_FORMAT_SUPPORT_DECODER_OUTPUT;
    return FindD3D11Format( vd, &vd->sys->d3d_dev, i_src_chroma, false, 0, 0, 0, is_d3d11_opaque(i_src_chroma), supportFlags );
}

static const d3d_format_t *GetDirectDecoderFormat(vout_display_t *vd, vlc_fourcc_t i_src_chroma)
{
    UINT supportFlags = D3D11_FORMAT_SUPPORT_DECODER_OUTPUT;
    return FindD3D11Format( vd, &vd->sys->d3d_dev, i_src_chroma, false, 0, 0, 0, is_d3d11_opaque(i_src_chroma), supportFlags );
}

static const d3d_format_t *GetDisplayFormatByDepth(vout_display_t *vd, uint8_t bit_depth,
                                                   uint8_t widthDenominator,
                                                   uint8_t heightDenominator,
                                                   bool from_processor,
                                                   bool rgb_only)
{
    UINT supportFlags = D3D11_FORMAT_SUPPORT_SHADER_LOAD;
    if (from_processor)
        supportFlags |= D3D11_FORMAT_SUPPORT_VIDEO_PROCESSOR_OUTPUT;
    return FindD3D11Format( vd, &vd->sys->d3d_dev, 0, rgb_only,
                            bit_depth, widthDenominator, heightDenominator,
                            false, supportFlags );
}

static const d3d_format_t *GetBlendableFormat(vout_display_t *vd, vlc_fourcc_t i_src_chroma)
{
    UINT supportFlags = D3D11_FORMAT_SUPPORT_SHADER_LOAD | D3D11_FORMAT_SUPPORT_BLENDABLE;
    return FindD3D11Format( vd, &vd->sys->d3d_dev, i_src_chroma, false, 0, 0, 0, false, supportFlags );
}

static bool CanUseTextureArray(vout_display_t *vd)
{
    // 15.200.1062.1004 is wrong - 2015/08/03 - 15.7.1 WHQL
    // 21.19.144.1281 is wrong   -
    // 22.19.165.3 is good       - 2017/05/04 - ReLive Edition 17.5.1
    struct wddm_version WDDM_os = {
        .wddm         = 21,  // starting with drivers designed for W10 Anniversary Update
    };
    if (D3D11CheckDriverVersion(&vd->sys->d3d_dev, GPU_MANUFACTURER_AMD, &WDDM_os) != VLC_SUCCESS)
    {
        msg_Dbg(vd, "AMD driver too old, fallback to legacy shader mode");
        return false;
    }

    // xx.xx.1000.xxx drivers can't happen here for WDDM > 2.0
    struct wddm_version WDDM_build = {
        .revision     = 162,
    };
    if (D3D11CheckDriverVersion(&vd->sys->d3d_dev, GPU_MANUFACTURER_AMD, &WDDM_build) != VLC_SUCCESS)
    {
        msg_Dbg(vd, "Bogus AMD driver detected, fallback to legacy shader mode");
        return false;
    }

    return true;
}

static bool BogusZeroCopy(const vout_display_t *vd)
{
    if (vd->sys->d3d_dev.adapterDesc.VendorId != GPU_MANUFACTURER_AMD)
        return false;

    switch (vd->sys->d3d_dev.adapterDesc.DeviceId)
    {
    case 0x687F: // RX Vega 56/64
    case 0x6863: // RX Vega Frontier Edition
    case 0x15DD: // RX Vega 8/11 (Ryzen iGPU)
    {
        struct wddm_version WDDM = {
            .revision     = 14011, // 18.10.2 - 2018/06/11
        };
        return D3D11CheckDriverVersion(&vd->sys->d3d_dev, GPU_MANUFACTURER_AMD, &WDDM) != VLC_SUCCESS;
    }
    default:
        return false;
    }
}

static int Direct3D11Open(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;

    /* the host's target decides the output color space */
    if (UpdateHostOutput(vd) != VLC_SUCCESS)
        return VLC_EGENERIC;

    video_format_Copy(&sys->pool_fmt, &vd->source);
    video_format_Copy(&sys->quad_fmt, &vd->source);
    int err = SetupOutputFormat(vd, &sys->pool_fmt, &sys->quad_fmt);
    if (err != VLC_SUCCESS)
    {
        if (!is_d3d11_opaque(vd->source.i_chroma))
        {
            const vlc_fourcc_t *list = vlc_fourcc_IsYUV(vd->source.i_chroma) ?
                        vlc_fourcc_GetYUVFallback(vd->source.i_chroma) :
                        vlc_fourcc_GetRGBFallback(vd->source.i_chroma);
            for (unsigned i = 0; list[i] != 0; i++) {
                sys->pool_fmt.i_chroma = list[i];
                if (sys->pool_fmt.i_chroma == vd->source.i_chroma)
                    continue;
                err = SetupOutputFormat(vd, &sys->pool_fmt, &sys->quad_fmt);
                if (err == VLC_SUCCESS)
                    break;
            }
        }
        if (err != VLC_SUCCESS)
            return err;
    }

    if ( sys->picQuad.formatInfo->formatTexture != DXGI_FORMAT_R8G8B8A8_UNORM &&
         sys->picQuad.formatInfo->formatTexture != DXGI_FORMAT_B5G6R5_UNORM )
    {
        sys->pool_fmt.i_width  = (sys->pool_fmt.i_width  + 0x01) & ~0x01;
        sys->pool_fmt.i_height = (sys->pool_fmt.i_height + 0x01) & ~0x01;
    }

    if (Direct3D11CreateGenericResources(vd)) {
        msg_Err(vd, "Failed to allocate resources");
        return VLC_EGENERIC;
    }

    video_format_Clean(&vd->fmt);
    video_format_Copy(&vd->fmt, &sys->pool_fmt);

    sys->log_level = var_InheritInteger(vd, "verbose");

    return VLC_SUCCESS;
}

static const d3d_format_t *SelectClosestOutput(vout_display_t *vd, vlc_fourcc_t i_chroma,
                                               bool from_processor)
{
    const d3d_format_t *res = NULL;

    // look for any pixel format that we can handle with enough pixels per channel
    uint8_t bits_per_channel;
    uint8_t widthDenominator, heightDenominator;
    switch (i_chroma)
    {
    case VLC_CODEC_D3D11_OPAQUE:
        bits_per_channel = 8;
        widthDenominator = heightDenominator = 2;
        break;
    case VLC_CODEC_D3D11_OPAQUE_10B:
        bits_per_channel = 10;
        widthDenominator = heightDenominator = 2;
        break;
    default:
        {
            const vlc_chroma_description_t *p_format = vlc_fourcc_GetChromaDescription(i_chroma);
            if (p_format == NULL)
            {
                bits_per_channel = 8;
                widthDenominator = heightDenominator = 2;
            }
            else
            {
                bits_per_channel = p_format->pixel_bits == 0 ? 8 : p_format->pixel_bits /
                                                                (p_format->plane_count==1 ? p_format->pixel_size : 1);
                widthDenominator = heightDenominator = 1;
                for (size_t i=0; i<p_format->plane_count; i++)
                {
                    if (widthDenominator < p_format->p[i].w.den)
                        widthDenominator = p_format->p[i].w.den;
                    if (heightDenominator < p_format->p[i].h.den)
                        heightDenominator = p_format->p[1].h.den;
                }
            }
        }
        break;
    }

    bool is_rgb = !vlc_fourcc_IsYUV(i_chroma);
    res = GetDisplayFormatByDepth(vd, bits_per_channel,
                                  widthDenominator,
                                  heightDenominator,
                                  from_processor, is_rgb);
    if (res != NULL)
        return res;
    if (is_rgb)
        res = GetDisplayFormatByDepth(vd, bits_per_channel,
                                      widthDenominator,
                                      heightDenominator,
                                      from_processor, false);
    if (res != NULL)
        return res;

    // look for any pixel format that we can handle
    res = GetDisplayFormatByDepth(vd, 0, 0, 0, false, false);
    return res;
}

static const d3d_format_t *SelectOutputFormat(vout_display_t *vd, const video_format_t *fmt,
                                              const d3d_format_t ** decoder_format)
{
    const d3d_format_t *res = NULL;
    // look for the requested pixel format first
    res = GetDirectRenderingFormat(vd, fmt->i_chroma);
    if (res != NULL)
        return res;

    /* look for a decoder format that can be decoded but not used in shaders */
    if ( is_d3d11_opaque(fmt->i_chroma) )
        *decoder_format = GetDirectDecoderFormat(vd, fmt->i_chroma);

    res = SelectClosestOutput(vd, fmt->i_chroma, *decoder_format!=NULL);

    return res;
}

static int SetupOutputFormat(vout_display_t *vd, video_format_t *fmt, video_format_t *quad_fmt)
{
    vout_display_sys_t *sys = vd->sys;

    // look for the requested pixel format first
    const d3d_format_t *decoder_format = NULL;
    sys->picQuad.formatInfo = SelectOutputFormat(vd, quad_fmt, &decoder_format);

    if ( !sys->picQuad.formatInfo )
    {
       msg_Err(vd, "Could not get a suitable texture pixel format");
       return VLC_EGENERIC;
    }
    sys->pool_d3dfmt = decoder_format ? decoder_format : sys->picQuad.formatInfo;

    msg_Dbg( vd, "Using pixel format %s for chroma %4.4s", sys->pool_d3dfmt->name,
                 (char *)&fmt->i_chroma );
    fmt->i_chroma = sys->pool_d3dfmt->fourcc;
    DxgiFormatMask( sys->picQuad.formatInfo->formatTexture, fmt );

    /* check the region pixel format */
    sys->d3dregion_format = GetBlendableFormat(vd, VLC_CODEC_RGBA);
    if (!sys->d3dregion_format)
        sys->d3dregion_format = GetBlendableFormat(vd, VLC_CODEC_BGRA);

    sys->legacy_shader = sys->d3d_dev.feature_level < D3D_FEATURE_LEVEL_10_0 ||
            !CanUseTextureArray(vd) ||
            BogusZeroCopy(vd);

    if (Direct3D11CreateFormatResources(vd, quad_fmt)) {
        msg_Err(vd, "Failed to allocate format resources");
        return VLC_EGENERIC;
    }
    vd->info.is_slow = !is_d3d11_opaque(fmt->i_chroma) && sys->picQuad.formatInfo->formatTexture != DXGI_FORMAT_UNKNOWN;

    return VLC_SUCCESS;
}

static void Direct3D11Close(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;

    Direct3D11DestroyResources(vd);

    D3D11_ReleaseDevice( &sys->d3d_dev );

    msg_Dbg(vd, "Direct3D11 device adapter closed");
}

static void UpdatePicQuadPosition(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;

    sys->picQuad.cropViewport.Width    = RECTWidth(sys->rect_dest_clipped);
    sys->picQuad.cropViewport.Height   = RECTHeight(sys->rect_dest_clipped);
    sys->picQuad.cropViewport.TopLeftX = sys->rect_dest_clipped.left;
    sys->picQuad.cropViewport.TopLeftY = sys->rect_dest_clipped.top;

    sys->picQuad.cropViewport.MinDepth = 0.0f;
    sys->picQuad.cropViewport.MaxDepth = 1.0f;

    SetQuadVSProjection(vd, &sys->picQuad, &vd->cfg->viewpoint);

#ifndef NDEBUG
    msg_Dbg(vd, "picQuad position (%.02f,%.02f) %.02fx%.02f", sys->picQuad.cropViewport.TopLeftX, sys->picQuad.cropViewport.TopLeftY, sys->picQuad.cropViewport.Width, sys->picQuad.cropViewport.Height );
#endif
}

/* TODO : handle errors better
   TODO : seperate out into smaller functions like createshaders */
static int Direct3D11CreateFormatResources(vout_display_t *vd, const video_format_t *fmt)
{
    vout_display_sys_t *sys = vd->sys;
    HRESULT hr;

    hr = D3D11_CompilePixelShader(vd, &sys->hd3d, sys->legacy_shader, &sys->d3d_dev,
                                  sys->picQuad.formatInfo, &sys->display, fmt->transfer, fmt->primaries,
                                  fmt->b_color_range_full,
                                  &sys->picQuad.d3dpixelShader);
    if (FAILED(hr))
    {
        msg_Err(vd, "Failed to create the pixel shader. (hr=0x%lX)", hr);
        return VLC_EGENERIC;
    }

    sys->picQuad.i_width  = fmt->i_width;
    sys->picQuad.i_height = fmt->i_height;

    UpdateRects(vd, NULL, true);

    if (!is_d3d11_opaque(fmt->i_chroma) || sys->legacy_shader)
    {
        /* we need a staging texture */
        int ret = CreateStaging(vd, NULL);
        if (ret != VLC_SUCCESS)
            return ret;
    }

    return VLC_SUCCESS;
}

#ifdef HAVE_D3D11_4_H
static HRESULT InitRenderFence(vout_display_sys_t *sys)
{
    HRESULT hr;
    sys->renderFinished = CreateEvent(NULL, TRUE, FALSE, NULL);
    if (unlikely(sys->renderFinished == NULL))
        return S_FALSE;
    ID3D11Device5 *d3ddev5 = NULL;
    hr = ID3D11DeviceContext_QueryInterface(sys->d3d_dev.d3dcontext, &IID_ID3D11DeviceContext4, (void**)&sys->d3dcontext4);
    if (FAILED(hr))
        goto error;
    hr = ID3D11Device_QueryInterface(sys->d3d_dev.d3ddevice, &IID_ID3D11Device5, (void**)&d3ddev5);
    if (FAILED(hr))
        goto error;
    hr = ID3D11Device5_CreateFence(d3ddev5, sys->renderFence, D3D11_FENCE_FLAG_NONE, &IID_ID3D11Fence, (void**)&sys->d3dRenderFence);
    if (FAILED(hr))
        goto error;
    ID3D11Device5_Release(d3ddev5);
    return hr;
error:
    if (d3ddev5)
        ID3D11Device5_Release(d3ddev5);
    if (sys->d3dRenderFence)
    {
        ID3D11Fence_Release(sys->d3dRenderFence);
        sys->d3dRenderFence = NULL;
    }
    if (sys->d3dcontext4)
    {
        ID3D11DeviceContext4_Release(sys->d3dcontext4);
        sys->d3dcontext4 = NULL;
    }
    CloseHandle(sys->renderFinished);
    sys->renderFinished = NULL;
    return hr;
}
#endif // HAVE_D3D11_4_H

static int Direct3D11CreateGenericResources(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;
    HRESULT hr;

#ifdef HAVE_D3D11_4_H
    hr = InitRenderFence(sys);
    if (SUCCEEDED(hr))
    {
        msg_Dbg(vd, "using GPU render fence");
    }
#endif

    if (CreateRenderStates(vd) != VLC_SUCCESS)
        return VLC_EGENERIC;

    UpdateRects(vd, NULL, true);

    if (sys->d3dregion_format != NULL)
    {
        hr = D3D11_CompilePixelShader(vd, &sys->hd3d, sys->legacy_shader, &sys->d3d_dev,
                                      sys->d3dregion_format, &sys->display, TRANSFER_FUNC_SRGB, COLOR_PRIMARIES_SRGB, true, &sys->pSPUPixelShader);
        if (FAILED(hr))
        {
            if (sys->picQuad.d3dpixelShader)
            {
                ID3D11PixelShader_Release(sys->picQuad.d3dpixelShader);
                sys->picQuad.d3dpixelShader = NULL;
            }
            msg_Err(vd, "Failed to create the SPU pixel shader. (hr=0x%lX)", hr);
            return VLC_EGENERIC;
        }
    }

    ID3DBlob *pVSBlob = D3D11_CompileShader(vd, &sys->hd3d, &sys->d3d_dev, globVertexShaderFlat, false);
    if (!pVSBlob)
        return VLC_EGENERIC;

    hr = ID3D11Device_CreateVertexShader(sys->d3d_dev.d3ddevice, (void *)ID3D10Blob_GetBufferPointer(pVSBlob),
                                        ID3D10Blob_GetBufferSize(pVSBlob), NULL, &sys->flatVSShader);

    if(FAILED(hr)) {
      ID3D10Blob_Release(pVSBlob);
      msg_Err(vd, "Failed to create the flat vertex shader. (hr=0x%lX)", hr);
      return VLC_EGENERIC;
    }

    D3D11_INPUT_ELEMENT_DESC layout[] = {
    { "POSITION", 0, DXGI_FORMAT_R32G32B32_FLOAT, 0, D3D11_APPEND_ALIGNED_ELEMENT, D3D11_INPUT_PER_VERTEX_DATA, 0},
    { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT,    0, D3D11_APPEND_ALIGNED_ELEMENT, D3D11_INPUT_PER_VERTEX_DATA, 0},
    };

    hr = ID3D11Device_CreateInputLayout(sys->d3d_dev.d3ddevice, layout, 2, (void *)ID3D10Blob_GetBufferPointer(pVSBlob),
                                        ID3D10Blob_GetBufferSize(pVSBlob), &sys->pVertexLayout);

    ID3D10Blob_Release(pVSBlob);

    if(FAILED(hr)) {
      msg_Err(vd, "Failed to create the vertex input layout. (hr=0x%lX)", hr);
      return VLC_EGENERIC;
    }

    pVSBlob = D3D11_CompileShader(vd, &sys->hd3d, &sys->d3d_dev, globVertexShaderProjection, false);
    if (!pVSBlob)
        return VLC_EGENERIC;

    hr = ID3D11Device_CreateVertexShader(sys->d3d_dev.d3ddevice, (void *)ID3D10Blob_GetBufferPointer(pVSBlob),
                                        ID3D10Blob_GetBufferSize(pVSBlob), NULL, &sys->projectionVSShader);

    if(FAILED(hr)) {
      ID3D10Blob_Release(pVSBlob);
      msg_Err(vd, "Failed to create the projection vertex shader. (hr=0x%lX)", hr);
      return VLC_EGENERIC;
    }
    ID3D10Blob_Release(pVSBlob);

    UpdatePicQuadPosition(vd);

    msg_Dbg(vd, "Direct3D11 resources created");
    return VLC_SUCCESS;
}

static void Direct3D11DestroyPool(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;

    if (sys->pool)
        picture_pool_Release(sys->pool);
    sys->pool = NULL;
    video_format_Clean(&sys->pool_fmt);
}

static void Direct3D11DestroyResources(vout_display_t *vd)
{
    vout_display_sys_t *sys = vd->sys;

    Direct3D11DestroyPool(vd);

    D3D11_ReleaseQuad(&sys->picQuad);
    Direct3D11DeleteRegions(sys->d3dregion_count, sys->d3dregions);
    sys->d3dregion_count = 0;
    sys->d3dregions = NULL;

    ReleasePictureSys(&sys->stagingSys);
    memset(&sys->stagingSys, 0, sizeof(sys->stagingSys));
    if (sys->sharedHandle != INVALID_HANDLE_VALUE)
        CloseHandle(sys->sharedHandle);
    sys->sharedHandle = INVALID_HANDLE_VALUE;

    video_format_Clean(&sys->quad_fmt);

    if (sys->pVertexLayout)
    {
        ID3D11InputLayout_Release(sys->pVertexLayout);
        sys->pVertexLayout = NULL;
    }
    if (sys->flatVSShader)
    {
        ID3D11VertexShader_Release(sys->flatVSShader);
        sys->flatVSShader = NULL;
    }
    if (sys->projectionVSShader)
    {
        ID3D11VertexShader_Release(sys->projectionVSShader);
        sys->projectionVSShader = NULL;
    }
    for (int i = 0; i < 2; i++)
    {
        if (sys->samplers[i])
        {
            ID3D11SamplerState_Release(sys->samplers[i]);
            sys->samplers[i] = NULL;
        }
    }
    if (sys->blendState)
    {
        ID3D11BlendState_Release(sys->blendState);
        sys->blendState = NULL;
    }
    if (sys->depthState)
    {
        ID3D11DepthStencilState_Release(sys->depthState);
        sys->depthState = NULL;
    }
    if (sys->pSPUPixelShader)
    {
        ID3D11PixelShader_Release(sys->pSPUPixelShader);
        sys->pSPUPixelShader = NULL;
    }
    if (sys->picQuad.d3dpixelShader)
    {
        ID3D11PixelShader_Release(sys->picQuad.d3dpixelShader);
        sys->picQuad.d3dpixelShader = NULL;
    }
#ifdef HAVE_D3D11_4_H
    if (sys->d3dcontext4)
    {
        ID3D11Fence_Release(sys->d3dRenderFence);
        sys->d3dRenderFence = NULL;
        ID3D11DeviceContext4_Release(sys->d3dcontext4);
        sys->d3dcontext4 = NULL;
        CloseHandle(sys->renderFinished);
        sys->renderFinished = NULL;
    }
#endif

    msg_Dbg(vd, "Direct3D11 resources destroyed");
}

static void Direct3D11DeleteRegions(int count, picture_t **region)
{
    for (int i = 0; i < count; ++i) {
        if (region[i]) {
            picture_Release(region[i]);
        }
    }
    free(region);
}

static void DestroyPictureQuad(picture_t *p_picture)
{
    D3D11_ReleaseQuad( (d3d_quad_t *) p_picture->p_sys );
    free( p_picture );
}

static int Direct3D11MapSubpicture(vout_display_t *vd, int *subpicture_region_count,
                                   picture_t ***region, subpicture_t *subpicture)
{
    vout_display_sys_t *sys = vd->sys;
    D3D11_MAPPED_SUBRESOURCE mappedResource;
    D3D11_TEXTURE2D_DESC texDesc;
    HRESULT hr;
    int err;

    if (sys->d3dregion_format == NULL)
        return VLC_EGENERIC;

    int count = 0;
    for (subpicture_region_t *r = subpicture->p_region; r; r = r->p_next)
        count++;

    *region = calloc(count, sizeof(picture_t *));
    if (unlikely(*region==NULL))
        return VLC_ENOMEM;
    *subpicture_region_count = count;

    int i = 0;
    for (subpicture_region_t *r = subpicture->p_region; r; r = r->p_next, i++) {
        if (!r->fmt.i_visible_width || !r->fmt.i_visible_height)
            continue; // won't render anything, keep the cache for later

        for (int j = 0; j < sys->d3dregion_count; j++) {
            picture_t *cache = sys->d3dregions[j];
            if (cache != NULL && ((d3d_quad_t *) cache->p_sys)->picSys.texture[KNOWN_DXGI_INDEX]) {
                ID3D11Texture2D_GetDesc( ((d3d_quad_t *) cache->p_sys)->picSys.texture[KNOWN_DXGI_INDEX], &texDesc );
                if (texDesc.Format == sys->d3dregion_format->formatTexture &&
                    texDesc.Width  == r->p_picture->format.i_width &&
                    texDesc.Height == r->p_picture->format.i_height) {
                    (*region)[i] = cache;
                    memset(&sys->d3dregions[j], 0, sizeof(cache)); // do not reuse this cached value
                    break;
                }
            }
        }

        RECT output;
        output.left   = r->fmt.i_x_offset;
        output.right  = r->fmt.i_x_offset + r->fmt.i_visible_width;
        output.top    = r->fmt.i_y_offset;
        output.bottom = r->fmt.i_y_offset + r->fmt.i_visible_height;

        picture_t *quad_picture = (*region)[i];
        if (quad_picture == NULL) {
            d3d_quad_t *d3dquad = calloc(1, sizeof(*d3dquad));
            if (unlikely(d3dquad==NULL)) {
                continue;
            }
            if (AllocateTextures(vd, &sys->d3d_dev, sys->d3dregion_format, &r->p_picture->format, false, false, 1, d3dquad->picSys.texture)) {
                msg_Err(vd, "Failed to allocate %dx%d texture for OSD",
                        r->fmt.i_visible_width, r->fmt.i_visible_height);
                for (int j=0; j<D3D11_MAX_SHADER_VIEW; j++)
                    if (d3dquad->picSys.texture[j])
                        ID3D11Texture2D_Release(d3dquad->picSys.texture[j]);
                free(d3dquad);
                continue;
            }

            if (D3D11_AllocateShaderView(vd, sys->d3d_dev.d3ddevice, sys->d3dregion_format,
                                         d3dquad->picSys.texture, 0,
                                         d3dquad->picSys.resourceView)) {
                msg_Err(vd, "Failed to create %dx%d shader view for OSD",
                        r->fmt.i_visible_width, r->fmt.i_visible_height);
                free(d3dquad);
                continue;
            }
            d3dquad->i_width    = r->fmt.i_width;
            d3dquad->i_height   = r->fmt.i_height;

            d3dquad->formatInfo = sys->d3dregion_format;
            err = D3D11_SetupQuad( vd, &sys->d3d_dev, &r->fmt, d3dquad, &sys->display, &output,
                             sys->flatVSShader, sys->pVertexLayout, PROJECTION_MODE_RECTANGULAR, ORIENT_NORMAL );
            if (err != VLC_SUCCESS) {
                msg_Err(vd, "Failed to create %dx%d quad for OSD",
                        r->fmt.i_visible_width, r->fmt.i_visible_height);
                free(d3dquad);
                continue;
            }
            d3dquad->d3dpixelShader = sys->pSPUPixelShader;
            picture_resource_t picres = {
                .p_sys      = (picture_sys_t *) d3dquad,
                .pf_destroy = DestroyPictureQuad,
            };
            (*region)[i] = picture_NewFromResource(&r->p_picture->format, &picres);
            if ((*region)[i] == NULL) {
                msg_Err(vd, "Failed to create %dx%d picture for OSD",
                        r->fmt.i_width, r->fmt.i_height);
                D3D11_ReleaseQuad(d3dquad);
                continue;
            }
            quad_picture = (*region)[i];
        } else {
            D3D11_UpdateQuadPosition(vd, &sys->d3d_dev, (d3d_quad_t *) quad_picture->p_sys, &output, ORIENT_NORMAL);
        }

        hr = ID3D11DeviceContext_Map(sys->d3d_dev.d3dcontext, ((d3d_quad_t *) quad_picture->p_sys)->picSys.resource[KNOWN_DXGI_INDEX], 0, D3D11_MAP_WRITE_DISCARD, 0, &mappedResource);
        if( SUCCEEDED(hr) ) {
            err = picture_UpdatePlanes(quad_picture, mappedResource.pData, mappedResource.RowPitch);
            if (err != VLC_SUCCESS) {
                msg_Err(vd, "Failed to set the buffer on the SPU picture" );
                ID3D11DeviceContext_Unmap(sys->d3d_dev.d3dcontext, ((d3d_quad_t *) quad_picture->p_sys)->picSys.resource[KNOWN_DXGI_INDEX], 0);
                picture_Release(quad_picture);
                if ((*region)[i] == quad_picture)
                    (*region)[i] = NULL;
                continue;
            }

            picture_CopyPixels(quad_picture, r->p_picture);

            ID3D11DeviceContext_Unmap(sys->d3d_dev.d3dcontext, ((d3d_quad_t *) quad_picture->p_sys)->picSys.resource[KNOWN_DXGI_INDEX], 0);
        } else {
            msg_Err(vd, "Failed to map the SPU texture (hr=0x%lX)", hr );
            picture_Release(quad_picture);
            if ((*region)[i] == quad_picture)
                (*region)[i] = NULL;
            continue;
        }

        d3d_quad_t *quad = (d3d_quad_t *) quad_picture->p_sys;

        vout_display_cfg_t place_cfg = *vd->cfg;
        if (sys->rect_display.right && sys->rect_display.bottom)
        {
            place_cfg.display.width  = sys->rect_display.right;
            place_cfg.display.height = sys->rect_display.bottom;
        } else {
            place_cfg.display.width  = RECTWidth(sys->rect_dest_clipped);
            place_cfg.display.height = RECTHeight(sys->rect_dest_clipped);
        }

        vout_display_place_t place;
        vout_display_PlacePicture(&place, &vd->source, &place_cfg, false);

        quad->cropViewport.Width =  (FLOAT) r->fmt.i_visible_width  * place.width  / subpicture->i_original_picture_width;
        quad->cropViewport.Height = (FLOAT) r->fmt.i_visible_height * place.height / subpicture->i_original_picture_height;
        quad->cropViewport.MinDepth = 0.0f;
        quad->cropViewport.MaxDepth = 1.0f;
        quad->cropViewport.TopLeftX = place.x + (FLOAT) r->i_x * place.width  / subpicture->i_original_picture_width;
        quad->cropViewport.TopLeftY = place.y + (FLOAT) r->i_y * place.height / subpicture->i_original_picture_height;

        D3D11_UpdateQuadOpacity(vd, &sys->d3d_dev, quad, r->i_alpha / 255.0f );
    }
    return VLC_SUCCESS;
}
