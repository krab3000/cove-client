#include "pch.h"

#include "HdrRenderer.h"

#include <d3dcompiler.h>

#include <algorithm>

#pragma warning(push, 0)
extern "C" {
#include <libavutil/mastering_display_metadata.h>
}
#pragma warning(pop)

namespace ReactNativeLibav {

namespace {

// Brightness of SDR reference white (BT.2408): HDR is tone mapped so this becomes white on an SDR display.
constexpr float kSdrWhiteNits = 203.0f;
// Assumed content peak when the stream has no MaxCLL / mastering metadata.
constexpr float kDefaultPeakNits = 1000.0f;

struct Params {
  float uvScale[2]; // frame size / texture size
  float codeScale;  // sampled UNORM value -> integer code value
  float depthScale; // 1 for 8-bit, 4 for 10-bit (range offsets scale with it)
  int fullRange;
  int transfer;    // 0 = PQ, 1 = HLG
  float srcPeak;   // nits
  float dstPeak;   // nits shown as SDR white
  float uvStep[2];  // one output pixel, in texture coordinates (for supersampling when downscaling)
  float padding[2];
};
static_assert(sizeof(Params) % 16 == 0);

constexpr char kShader[] = R"(
cbuffer Params : register(b0) {
  float2 uvScale;
  float codeScale;
  float depthScale;
  int fullRange;
  int transfer;
  float srcPeak;
  float dstPeak;
  float2 uvStep;
};
Texture2D<float> texY : register(t0);
Texture2D<float2> texC : register(t1);
SamplerState samp : register(s0);

struct VSOut { float4 pos : SV_Position; float2 uv : TEXCOORD0; };

// One triangle covering the viewport.
VSOut VS(uint id : SV_VertexID) {
  VSOut o;
  float2 t = float2((id << 1) & 2, id & 2);
  o.pos = float4(t * float2(2, -2) + float2(-1, 1), 0, 1);
  o.uv = t * uvScale;
  return o;
}

static const float m1 = 0.1593017578125, m2 = 78.84375;
static const float c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;

float3 PqToNits(float3 e) {
  float3 p = pow(saturate(e), 1.0 / m2);
  return pow(max(p - c1, 0) / (c2 - c3 * p), 1.0 / m1) * 10000.0;
}
float NitsToPq(float nits) {
  float y = pow(saturate(nits / 10000.0), m1);
  return pow((c1 + c2 * y) / (1 + c3 * y), m2);
}
float PqToNits1(float e) { return PqToNits(float3(e, e, e)).x; }

// HLG inverse OETF and OOTF, for a 1000 nit reference display (BT.2100).
float3 HlgToNits(float3 e) {
  const float a = 0.17883277, b = 0.28466892, c = 0.55991073;
  float3 s = e <= 0.5 ? e * e / 3.0 : (exp((e - c) / a) + b) / 12.0;
  float ys = dot(s, float3(0.2627, 0.6780, 0.0593));
  return 1000.0 * pow(max(ys, 1e-6), 0.2) * s;
}

// BT.2390 EETF: rolls srcPeak off onto dstPeak with a Hermite spline in PQ space, leaving darker tones as they are.
float ToneMap(float nits) {
  float srcPq = NitsToPq(srcPeak);
  float e1 = NitsToPq(nits) / srcPq;
  float maxLum = NitsToPq(dstPeak) / srcPq;
  float ks = 1.5 * maxLum - 0.5;
  float e2 = e1;
  if (e1 > ks) {
    float t = (e1 - ks) / (1 - ks), t2 = t * t, t3 = t2 * t;
    e2 = (2 * t3 - 3 * t2 + 1) * ks + (t3 - 2 * t2 + t) * (1 - ks) + (-2 * t3 + 3 * t2) * maxLum;
  }
  return PqToNits1(min(e2, 1.0) * srcPq);
}

float3 SrgbEncode(float3 l) {
  return l <= 0.0031308 ? 12.92 * l : 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}

float4 PS(VSOut i) : SV_Target {
  // 2x2 bilinear taps across the output pixel: a 4x4 texel footprint, enough to keep a 4K picture shown at a
  // quarter of its size from aliasing.
  float yCode = 0; float2 cCode = 0;
  [unroll] for (int k = 0; k < 4; ++k) {
    float2 uv = i.uv + (float2(k & 1, k >> 1) - 0.5) * 0.5 * uvStep;
    yCode += texY.Sample(samp, uv);
    cCode += texC.Sample(samp, uv);
  }
  yCode *= codeScale / 4;
  cCode *= codeScale / 4;
  float y; float2 c;
  if (fullRange) {
    float maxCode = 256.0 * depthScale - 1.0;
    y = yCode / maxCode;
    c = (cCode - 128.0 * depthScale) / maxCode;
  } else {
    y = (yCode - 16.0 * depthScale) / (219.0 * depthScale);
    c = (cCode - 128.0 * depthScale) / (224.0 * depthScale);
  }
  // BT.2020 non-constant luminance YCbCr -> R'G'B'
  float3 rgb = saturate(float3(y + 1.4746 * c.y, y - 0.16455 * c.x - 0.57135 * c.y, y + 1.8814 * c.x));

  float3 nits = transfer == 0 ? PqToNits(rgb) : HlgToNits(rgb);
  // Tone map the brightest channel and scale the others with it: keeps hue and saturation.
  float peak = max(nits.r, max(nits.g, nits.b));
  if (srcPeak > dstPeak && peak > 1e-3)
    nits *= ToneMap(peak) / peak;

  float3 linear2020 = nits / dstPeak;
  float3 linear709 = mul(float3x3( 1.6605, -0.5876, -0.0728,
                                  -0.1246,  1.1329, -0.0083,
                                  -0.0182, -0.1006,  1.1187), linear2020);
  return float4(SrgbEncode(saturate(linear709)), 1);
}
)";

winrt::com_ptr<ID3DBlob> Compile(const char *entry, const char *target) {
  winrt::com_ptr<ID3DBlob> code, errors;
  const HRESULT hr = D3DCompile(kShader, sizeof(kShader) - 1, "HdrRenderer", nullptr, nullptr, entry, target,
                                D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, code.put(), errors.put());
  if (FAILED(hr) && errors)
    OutputDebugStringA(static_cast<const char *>(errors->GetBufferPointer()));
  winrt::check_hresult(hr);
  return code;
}

} // namespace

HdrRenderer::HdrRenderer(ID3D11Device *device) {
  m_device.copy_from(device);
  m_device->GetImmediateContext(m_context.put());

  auto vs = Compile("VS", "vs_5_0");
  auto ps = Compile("PS", "ps_5_0");
  winrt::check_hresult(m_device->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr, m_vs.put()));
  winrt::check_hresult(m_device->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr, m_ps.put()));

  D3D11_SAMPLER_DESC sampler{};
  sampler.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sampler.AddressU = sampler.AddressV = sampler.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
  sampler.MaxLOD = D3D11_FLOAT32_MAX;
  winrt::check_hresult(m_device->CreateSamplerState(&sampler, m_sampler.put()));

  D3D11_BUFFER_DESC buffer{};
  buffer.ByteWidth = sizeof(Params);
  buffer.Usage = D3D11_USAGE_DEFAULT;
  buffer.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
  winrt::check_hresult(m_device->CreateBuffer(&buffer, nullptr, m_params.put()));
}

bool HdrRenderer::EnsureSource(const D3D11_TEXTURE2D_DESC &desc) {
  if (m_source && m_sourceDesc.Width == desc.Width && m_sourceDesc.Height == desc.Height &&
      m_sourceDesc.Format == desc.Format)
    return true;
  m_source = nullptr;
  m_luma = nullptr;
  m_chroma = nullptr;

  DXGI_FORMAT lumaFormat, chromaFormat;
  if (desc.Format == DXGI_FORMAT_P010) {
    lumaFormat = DXGI_FORMAT_R16_UNORM;
    chromaFormat = DXGI_FORMAT_R16G16_UNORM;
  } else if (desc.Format == DXGI_FORMAT_NV12) {
    lumaFormat = DXGI_FORMAT_R8_UNORM;
    chromaFormat = DXGI_FORMAT_R8G8_UNORM;
  } else {
    return false;
  }

  D3D11_TEXTURE2D_DESC source{};
  source.Width = desc.Width;
  source.Height = desc.Height;
  source.MipLevels = 1;
  source.ArraySize = 1;
  source.Format = desc.Format;
  source.SampleDesc.Count = 1;
  source.Usage = D3D11_USAGE_DEFAULT;
  source.BindFlags = D3D11_BIND_SHADER_RESOURCE;
  if (FAILED(m_device->CreateTexture2D(&source, nullptr, m_source.put())))
    return false;

  D3D11_SHADER_RESOURCE_VIEW_DESC view{};
  view.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
  view.Texture2D.MipLevels = 1;
  view.Format = lumaFormat; // the luma plane
  if (FAILED(m_device->CreateShaderResourceView(m_source.get(), &view, m_luma.put())))
    return false;
  view.Format = chromaFormat; // the interleaved, half resolution chroma plane
  if (FAILED(m_device->CreateShaderResourceView(m_source.get(), &view, m_chroma.put())))
    return false;
  m_sourceDesc = source;
  return true;
}

void HdrRenderer::UpdatePeak(const AVFrame *frame) noexcept {
  // MaxCLL is the brightest pixel actually in the content; the mastering display peak is an upper bound.
  if (const AVFrameSideData *sd = av_frame_get_side_data(frame, AV_FRAME_DATA_CONTENT_LIGHT_LEVEL)) {
    const auto *light = reinterpret_cast<const AVContentLightMetadata *>(sd->data);
    if (light->MaxCLL > 0) {
      m_peak = float(light->MaxCLL);
      return;
    }
  }
  if (const AVFrameSideData *sd = av_frame_get_side_data(frame, AV_FRAME_DATA_MASTERING_DISPLAY_METADATA)) {
    const auto *mastering = reinterpret_cast<const AVMasteringDisplayMetadata *>(sd->data);
    if (mastering->has_luminance && !m_peak)
      m_peak = float(av_q2d(mastering->max_luminance));
  }
}

bool HdrRenderer::Draw(const AVFrame *frame, ID3D11Texture2D *texture, UINT slice, ID3D11Texture2D *target,
                       const RECT &dest) {
  D3D11_TEXTURE2D_DESC desc{};
  texture->GetDesc(&desc);
  if (!EnsureSource(desc))
    return false;
  m_context->CopySubresourceRegion(m_source.get(), 0, 0, 0, 0, texture, D3D11CalcSubresource(0, slice, desc.MipLevels),
                                   nullptr);

  winrt::com_ptr<ID3D11RenderTargetView> rtv;
  if (FAILED(m_device->CreateRenderTargetView(target, nullptr, rtv.put())))
    return false;

  UpdatePeak(frame);
  const bool tenBit = desc.Format == DXGI_FORMAT_P010;
  Params params{};
  params.uvScale[0] = float(frame->width) / float(desc.Width);
  params.uvScale[1] = float(frame->height) / float(desc.Height);
  params.codeScale = tenBit ? 65535.0f / 64.0f : 255.0f; // P010 keeps its 10 bits in the top of 16
  params.depthScale = tenBit ? 4.0f : 1.0f;
  params.fullRange = frame->color_range == AVCOL_RANGE_JPEG;
  params.transfer = frame->color_trc == AVCOL_TRC_ARIB_STD_B67 ? 1 : 0;
  params.srcPeak = std::clamp(m_peak > 0 ? m_peak : kDefaultPeakNits, 400.0f, 10000.0f);
  params.dstPeak = kSdrWhiteNits;
  params.uvStep[0] = params.uvScale[0] / float(std::max<LONG>(dest.right - dest.left, 1));
  params.uvStep[1] = params.uvScale[1] / float(std::max<LONG>(dest.bottom - dest.top, 1));
  m_context->UpdateSubresource(m_params.get(), 0, nullptr, &params, 0, 0);

  const D3D11_VIEWPORT viewport{float(dest.left), float(dest.top), float(dest.right - dest.left),
                                float(dest.bottom - dest.top), 0, 1};
  ID3D11ShaderResourceView *views[] = {m_luma.get(), m_chroma.get()};
  ID3D11SamplerState *samplers[] = {m_sampler.get()};
  ID3D11Buffer *buffers[] = {m_params.get()};
  ID3D11RenderTargetView *targets[] = {rtv.get()};

  // The context is shared (decoder, composition): set all the state we use, and unbind the views afterwards.
  m_context->ClearState();
  m_context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
  m_context->VSSetShader(m_vs.get(), nullptr, 0);
  m_context->VSSetConstantBuffers(0, 1, buffers);
  m_context->PSSetShader(m_ps.get(), nullptr, 0);
  m_context->PSSetConstantBuffers(0, 1, buffers);
  m_context->PSSetShaderResources(0, 2, views);
  m_context->PSSetSamplers(0, 1, samplers);
  m_context->RSSetViewports(1, &viewport);
  m_context->OMSetRenderTargets(1, targets, nullptr);
  m_context->Draw(3, 0);
  m_context->ClearState();
  return true;
}

} // namespace ReactNativeLibav
