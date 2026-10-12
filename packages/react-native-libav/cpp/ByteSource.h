#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace ReactNativeLibav {

// A source the player reads through a custom AVIOContext instead of FFmpeg's own protocols: http(s) sources are read
// through the HTTP cache (CachedHttpSource over ChunkCache: RAM and disk tiers, a platform HttpFetcher). Read and
// Seek are called on the demux thread; Abort from another.
class ByteSource {
 public:
  virtual ~ByteSource() = default;
  // Reads up to size bytes at the current position: the count read, 0 at the end, < 0 (an AVERROR) on failure.
  virtual int Read(uint8_t *buffer, int size) = 0;
  // As AVIOContext's seek: whence is SEEK_SET, SEEK_CUR, SEEK_END or AVSEEK_SIZE (the total size, < 0 if unknown).
  virtual int64_t Seek(int64_t offset, int whence) = 0;
  // Makes a Read in progress, and any later one, fail at once (the player is closing).
  virtual void Abort() = 0;
  // For the startup log, e.g. "cache+kotlin".
  virtual const char *Name() const = 0;
  // What it has done so far, for the startup log (e.g. where the chunks read came from); empty if nothing to tell.
  virtual std::string Summary() const { return {}; }
};

// Makes the source for a URL, or returns nullptr to let FFmpeg open it.
using ByteSourceFactory = std::function<std::unique_ptr<ByteSource>(const std::string &url)>;

} // namespace ReactNativeLibav
