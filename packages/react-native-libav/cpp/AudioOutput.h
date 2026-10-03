#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "AudioDevice.h"
#include "Clock.h"
#include "FFmpeg.h"
#include "Queues.h"

namespace ReactNativeLibav {

// Decodes the audio stream and resamples it to the device format (float32), feeding an AudioDevice that pulls it
// on its own thread. It is the master clock: for each buffer it sets the clock to the pts of the sample being heard
// now (the buffer's first sample minus the device's delay).
class AudioOutput {
 public:
  AudioOutput(AVStream *stream, PacketQueue &packets, Clock &clock, const SeekState &seek);
  ~AudioOutput();

  // Opens the decoder and the device and starts playing. False if either cannot be opened.
  bool Start();
  // Stops the device; no more decoding once it returns. The destructor does it too.
  void Stop();

  void SetPaused(bool paused);
  void SetVolume(float volume) noexcept { m_volume = volume; }
  void SetMuted(bool muted) noexcept { m_muted = muted; }

  // The device failed: the player falls back to the system clock.
  bool Failed() const noexcept { return m_device && m_device->Failed(); }
  // All audio up to the end of the stream has been played out.
  bool Finished() const noexcept { return m_finished; }

 private:
  // The AudioDevice source (device thread).
  size_t Render(float *out, size_t frames, double delay, bool &flush);
  // Decodes until there are converted samples pending. False when no packet is available right now.
  bool Refill();
  bool Convert(const AVFrame *frame);
  // Forgets everything decoded so far (a seek).
  void Flush();

  AVStream *m_stream;
  PacketQueue &m_packets;
  Clock &m_clock;
  const SeekState &m_seek;
  int m_serial = 0;     // serial of what we are decoding and playing
  double m_target = -1; // drop samples before this pts (after a seek)

  std::unique_ptr<AudioDevice> m_device;
  CodecContextPtr m_codec;
  SwrContext *m_swr = nullptr;
  int m_swrFormat = -1;
  int m_swrRate = 0;
  AVChannelLayout m_swrLayout{};
  AVChannelLayout m_outLayout{};
  int m_outRate = 0;
  int m_outChannels = 0;

  std::vector<float> m_pending; // interleaved, converted
  size_t m_pendingPos = 0;      // in samples (frames * channels)
  double m_pendingPts = 0;      // pts of m_pending[0]
  double m_nextPts = 0;
  bool m_draining = false;  // sent the decoder a null packet
  bool m_loopFlush = false; // ...because of a loop (flush and continue) rather than the end
  bool m_decoderEnded = false;

  std::atomic<float> m_volume{1.0f};
  std::atomic<bool> m_muted{false};
  std::atomic<bool> m_paused{false};
  std::atomic<bool> m_finished{false};
};

} // namespace ReactNativeLibav
