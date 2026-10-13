#pragma once

#include <cerrno>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

#ifndef ESTALE
#define ESTALE 116 // not in the MSVC runtime's errno.h; Linux's value
#endif

namespace ReactNativeMpv {

// What Read and Seek return on failure (negative errno values), and Seek's whence for the total size.
constexpr int kSourceFailed = -EIO;        // the server or the network failed
constexpr int kSourceAborted = -ECANCELED; // Abort was called
constexpr int kSourceChanged = -ESTALE;    // the media changed on the server while it played
constexpr int kSeekSize = 0x10000;         // Seek(0, kSeekSize): the total size

// What mpv reads an http(s) source through (MpvPlayer's stream callbacks): the HTTP cache (CachedHttpSource over
// ChunkCache: RAM and disk tiers, a platform HttpFetcher). Read and Seek are called on mpv's demux thread; Abort from
// another.
class ByteSource {
 public:
  virtual ~ByteSource() = default;
  // Reads up to size bytes at the current position: the count read, 0 at the end, < 0 (kSource*) on failure.
  virtual int Read(uint8_t *buffer, int size) = 0;
  // whence is SEEK_SET, SEEK_CUR, SEEK_END or kSeekSize (the total size, < 0 if unknown). The new position, or < 0.
  virtual int64_t Seek(int64_t offset, int whence) = 0;
  // Makes a Read in progress, and any later one, fail at once (the player is closing).
  virtual void Abort() = 0;
  // For the startup log, e.g. "cache+kotlin".
  virtual const char *Name() const = 0;
  // What it has done so far, for the startup log (e.g. where the chunks read came from); empty if nothing to tell.
  virtual std::string Summary() const { return {}; }
};

// Makes the source for a URL (nullptr: none).
using ByteSourceFactory = std::function<std::unique_ptr<ByteSource>(const std::string &url)>;

} // namespace ReactNativeMpv
