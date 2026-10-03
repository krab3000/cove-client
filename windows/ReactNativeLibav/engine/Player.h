#pragma once

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <thread>

#include "AudioOutput.h"
#include "Clock.h"
#include "FFmpeg.h"
#include "Queues.h"
#include "VideoOutput.h"

namespace ReactNativeLibav {

struct MediaInfo {
  double duration = 0;
  int width = 0;
  int height = 0;
  bool hasAudio = false;
  bool hwDecoding = false;
  std::string codec;
};

// Callbacks run on player threads.
struct PlayerCallbacks {
  std::function<void(const MediaInfo &)> onLoad;
  std::function<void(double currentTime, double duration)> onProgress;
  std::function<void()> onEnd;
  std::function<void(const std::string &)> onError;
};

// Plays one source into a VideoOutput. Threads:
//   demux:  opens the input, then reads packets into the video/audio queues (loops by seeking to the start and
//           shifting timestamps, so the clock keeps running forward)
//   decode: video packets -> frames (D3D11 surfaces from D3D11VA, or NV12 from the software fallback)
//   render: presents each frame when the master clock reaches it, drops late frames
//   audio:  see AudioOutput (master clock)
class Player {
 public:
  Player(std::shared_ptr<VideoOutput> output, PlayerCallbacks callbacks);
  ~Player();

  void Open(std::string source, bool hardwareDecoding);
  void SetPaused(bool paused);
  void SetMuted(bool muted);
  void SetVolume(float volume);
  void SetLoop(bool loop) noexcept { m_loop = loop; }

 private:
  void Demux(std::string source);
  void OpenInput(const std::string &source);
  void OpenVideoDecoder();
  void DecodeVideo();
  bool ReceiveVideoFrames();
  FramePtr ToNv12(FramePtr frame);
  void Render();
  void Fail(const std::string &message);
  static AVPixelFormat GetFormat(AVCodecContext *ctx, const AVPixelFormat *formats);
  static int Interrupt(void *opaque) noexcept;

  std::shared_ptr<VideoOutput> m_output;
  PlayerCallbacks m_callbacks;

  AVFormatContext *m_format = nullptr;
  int m_videoIndex = -1;
  int m_audioIndex = -1;
  AVRational m_videoTimeBase{1, 1};
  double m_startTime = 0;
  double m_duration = 0;
  CodecContextPtr m_videoCodec;
  SwsContext *m_sws = nullptr;
  bool m_hardwareDecoding = true;
  std::atomic<bool> m_hwActive{false};
  bool m_loaded = false;

  PacketQueue m_videoPackets;
  PacketQueue m_audioPackets;
  FrameQueue m_frames{4};
  Clock m_clock;
  std::mutex m_audioMutex; // guards m_audio against the setters while the demux thread creates it
  std::unique_ptr<AudioOutput> m_audio;
  std::atomic<bool> m_videoEnded{false};

  std::thread m_demuxThread;
  std::thread m_decodeThread;
  std::thread m_renderThread;
  std::atomic<bool> m_abort{false};
  std::atomic<bool> m_failed{false};
  std::atomic<bool> m_paused{false};
  std::atomic<bool> m_muted{false};
  std::atomic<float> m_volume{1.0f};
  std::atomic<bool> m_loop{false};
};

} // namespace ReactNativeLibav
