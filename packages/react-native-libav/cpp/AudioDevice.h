#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>

namespace ReactNativeLibav {

// An audio output, implemented per platform (Windows: WASAPI, Android: AAudio). It plays float32 interleaved samples
// at its own format, pulling them from a source on its own thread.
class AudioDevice {
 public:
  struct Format {
    int sampleRate = 48000;
    int channels = 2;
    uint64_t channelMask = 0; // speaker positions (WAVEFORMATEXTENSIBLE dwChannelMask layout), 0 = default for channels
  };

  // Fills frames frames of out and returns how many of them are real audio (the device silences the rest).
  // delay: seconds until out[0] is heard. Setting flush asks the device to drop what it still has buffered (a seek)
  // before playing the next buffer; devices with short buffers may ignore it.
  using Source = std::function<size_t(float *out, size_t frames, double delay, bool &flush)>;

  virtual ~AudioDevice() = default;
  virtual Format GetFormat() const = 0;
  // Begins pulling from source. Starts paused if SetPaused(true) was called before.
  virtual void Start(Source source) = 0;
  virtual void SetPaused(bool paused) = 0;
  // Stops pulling: no Source calls once it returns.
  virtual void Stop() = 0;
  // The device failed (unplugged and could not be reopened, ...): the player continues on the system clock.
  virtual bool Failed() const = 0;
};

// Opens the default output device. Throws std::runtime_error.
std::unique_ptr<AudioDevice> CreateAudioDevice();

} // namespace ReactNativeLibav
