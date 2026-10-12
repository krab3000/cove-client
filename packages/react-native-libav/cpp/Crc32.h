#pragma once

// CRC-32 (IEEE, as zlib), table-driven: checks disk cache chunks without depending on FFmpeg.

#include <array>
#include <cstddef>
#include <cstdint>

namespace ReactNativeLibav {

inline uint32_t Crc32(const uint8_t *data, size_t size, uint32_t crc = 0) {
  static const std::array<uint32_t, 256> table = [] {
    std::array<uint32_t, 256> t{};
    for (uint32_t i = 0; i < 256; ++i) {
      uint32_t c = i;
      for (int k = 0; k < 8; ++k)
        c = c & 1 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      t[i] = c;
    }
    return t;
  }();
  crc = ~crc;
  for (size_t i = 0; i < size; ++i)
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
  return ~crc;
}

} // namespace ReactNativeLibav
