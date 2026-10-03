#pragma once

#include <d3d11_1.h>

#include "FFmpeg.h"

namespace ReactNativeLibav {

// Draws HDR video (PQ / HLG, BT.2020) into an 8-bit SDR target with a pixel shader: YCbCr -> RGB, PQ/HLG -> nits,
// BT.2390 tone mapping of the content peak onto SDR reference white, BT.2020 -> BT.709 gamut, sRGB encoding.
// The D3D11 video processor only clips HDR to SDR (blown highlights, oversaturated colour), hence this.
class HdrRenderer {
 public:
  explicit HdrRenderer(ID3D11Device *device); // throws winrt::hresult_error

  static bool IsHdr(const AVFrame *frame) noexcept {
    return frame->color_trc == AVCOL_TRC_SMPTE2084 || frame->color_trc == AVCOL_TRC_ARIB_STD_B67;
  }

  // Draws slice of texture (NV12 or P010; frame describes its content) into dest of target, which must be a
  // render target texture. The caller clears the letterbox around dest.
  bool Draw(const AVFrame *frame, ID3D11Texture2D *texture, UINT slice, ID3D11Texture2D *target, const RECT &dest);

  // Forgets the content peak learnt from metadata (new stream).
  void Reset() noexcept { m_peak = 0; }

 private:
  bool EnsureSource(const D3D11_TEXTURE2D_DESC &desc);
  void UpdatePeak(const AVFrame *frame) noexcept;

  winrt::com_ptr<ID3D11Device> m_device;
  winrt::com_ptr<ID3D11DeviceContext> m_context;
  winrt::com_ptr<ID3D11VertexShader> m_vs;
  winrt::com_ptr<ID3D11PixelShader> m_ps;
  winrt::com_ptr<ID3D11SamplerState> m_sampler;
  winrt::com_ptr<ID3D11Buffer> m_params;

  // Decoder surfaces cannot be read by shaders: each frame is copied here first (cheap, on the GPU).
  winrt::com_ptr<ID3D11Texture2D> m_source;
  winrt::com_ptr<ID3D11ShaderResourceView> m_luma;
  winrt::com_ptr<ID3D11ShaderResourceView> m_chroma;
  D3D11_TEXTURE2D_DESC m_sourceDesc{};

  float m_peak = 0; // content peak in nits from MaxCLL / mastering metadata, 0 = unknown
};

} // namespace ReactNativeLibav
