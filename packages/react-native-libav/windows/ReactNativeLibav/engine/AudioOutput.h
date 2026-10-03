#pragma once

#include <atomic>
#include <condition_variable>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "Clock.h"
#include "FFmpeg.h"
#include "Queues.h"

namespace ReactNativeLibav {

// Decodes the audio stream, resamples it to the device mix format (float32) and plays it through WASAPI in shared,
// event-driven mode. It is the master clock: after each write it sets the clock to the pts of the sample the
// device is playing now (the end of what it was given, minus what is still buffered).
class AudioOutput {
 public:
  AudioOutput(AVStream *stream, PacketQueue &packets, Clock &clock, const SeekState &seek,
              std::function<void(std::string)> onError);
  ~AudioOutput();

  // Opens the decoder and starts the playback thread. False if the decoder could not be opened.
  bool Start();

  // Stops playback and joins the thread; the destructor does it too.
  void Stop();

  void SetPaused(bool paused);
  void SetVolume(float volume) noexcept { m_volume = volume; }
  void SetMuted(bool muted) noexcept { m_muted = muted; }

  // The device could not be opened: the player falls back to the system clock.
  bool Failed() const noexcept { return m_failed; }
  // All audio up to the end of the stream has been played out.
  bool Finished() const noexcept { return m_finished; }

 private:
  void Run();
  void Play();
  // Decodes until there are converted samples pending. False when no packet is available right now.
  bool Refill();
  bool Convert(const AVFrame *frame);
  // Forgets everything decoded or buffered so far (a seek).
  void Flush();

  AVStream *m_stream;
  PacketQueue &m_packets;
  Clock &m_clock;
  const SeekState &m_seek;
  int m_serial = 0;       // serial of what we are decoding and playing
  double m_target = -1;   // drop samples before this pts (after a seek)
  std::function<void(std::string)> m_onError;

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
  bool m_draining = false; // sent the decoder a null packet
  bool m_loopFlush = false; // ...because of a loop (flush and continue) rather than the end
  bool m_decoderEnded = false;

  std::thread m_thread;
  std::mutex m_mutex;
  std::condition_variable m_cv;
  std::atomic<bool> m_stop{false};
  std::atomic<bool> m_paused{false};
  std::atomic<float> m_volume{1.0f};
  std::atomic<bool> m_muted{false};
  std::atomic<bool> m_failed{false};
  std::atomic<bool> m_finished{false};
};

} // namespace ReactNativeLibav
