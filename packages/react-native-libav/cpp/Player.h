#pragma once

#include <atomic>
#include <chrono>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "AudioOutput.h"
#include "ByteSource.h"
#include "Clock.h"
#include "FFmpeg.h"
#include "Queues.h"
#include "Trace.h"
#include "VideoSink.h"

namespace ReactNativeLibav {

struct AudioTrackInfo {
  int index = -1; // stream index
  std::string language;
  std::string title;
  std::string codec;
  int channels = 0;
  int sampleRate = 0;
};

struct MediaInfo {
  double duration = 0;
  int width = 0;
  int height = 0;
  double aspect = 0; // display aspect ratio (sample aspect ratio applied)
  bool hasAudio = false;
  bool hwDecoding = false;
  std::string codec;
  std::vector<AudioTrackInfo> audioTracks;
  int audioTrack = -1;
};

// Callbacks run on player threads.
struct PlayerCallbacks {
  std::function<void(const MediaInfo &)> onLoad;
  std::function<void(double currentTime, double duration)> onProgress;
  std::function<void(double currentTime)> onSeek;
  std::function<void()> onEnd;
  std::function<void(const std::string &)> onError;
};

// Plays one source into a VideoSink (the platform's video output) and an AudioDevice (through AudioOutput). Threads:
//   demux:  opens the input, then reads packets into the video/audio queues (loops by seeking to the start and
//           shifting timestamps, so the clock keeps running forward); carries out seeks and audio track switches
//   decode: video packets -> frames (hardware frames from the sink's decoder, or software frames in its format)
//   render: presents each frame when the master clock reaches it, paced by the sink (display refresh)
//   audio:  see AudioOutput (master clock)
// A seek bumps the serial in m_seek: queues are cleared, every stage flushes when it meets the new serial and
// drops anything older, and the decoders drop what precedes the target so the seek is frame accurate.
class Player {
 public:
  Player(std::shared_ptr<VideoSink> sink, PlayerCallbacks callbacks);
  ~Player();

  // audioTrack: stream index to play, -1 for the default one.
  void Open(std::string source, bool hardwareDecoding, int audioTrack);
  void SetPaused(bool paused);
  void SetMuted(bool muted);
  void SetVolume(float volume);
  void SetLoop(bool loop) noexcept { m_loop = loop; }
  // For https sources: verify the server certificate (the default). Applies to the next Open.
  void SetTlsVerify(bool verify) noexcept { m_tlsVerify = verify; }
  // FFmpeg options for opening the input, "key=value:key=value", passed to avformat_open_input: the demuxer's
  // (probesize=1000000, interleaved_read=0, ...) and the protocol's (multiple_requests=1, short_seek_size=..., ...).
  // async=1 reads the source through FFmpeg's async: protocol (a read-ahead thread). Applies to the next Open.
  void SetInputOptions(std::string options) { m_inputOptions = std::move(options); }
  // Where http(s) sources are read from (see ByteSource); without one, or when it returns nullptr, FFmpeg's own
  // http protocol reads them. Applies to the next Open.
  void SetByteSourceFactory(ByteSourceFactory factory) { m_sourceFactory = std::move(factory); }
  // Seconds from the start. Asynchronous: onSeek reports when the frame there is on screen.
  void Seek(double seconds);
  // Stream index, -1 for the default track. Playback continues from the current position on the new track.
  void SetAudioTrack(int index);

 private:
  void Demux(std::string source);
  void OpenInput(const std::string &source, int audioTrack);
  void OpenVideoDecoder();
  bool OpenDecoder(const AVCodec *codec, bool hardware);
  bool StartAudio(int index);
  int ValidAudioTrack(int index) const;
  // Applies pending seek / audio track requests; returns true if it seeked.
  bool HandleRequests();
  void DecodeVideo();
  bool ReceiveVideoFrames();
  FramePtr ToSoftwareFormat(FramePtr frame);
  void Render();
  std::shared_ptr<AudioOutput> Audio();
  void Fail(const std::string &message);
  static int Interrupt(void *opaque) noexcept;
  static int ReadSource(void *opaque, uint8_t *buffer, int size);
  static int64_t SeekSource(void *opaque, int64_t offset, int whence);
  double SinceOpen() const;
  void LogStartup(double onScreen) const;

  std::shared_ptr<VideoSink> m_sink;
  PlayerCallbacks m_callbacks;

  AVFormatContext *m_format = nullptr;
  int m_videoIndex = -1;
  int m_audioIndex = -1; // demux thread
  AVRational m_videoTimeBase{1, 1};
  double m_startTime = 0;
  double m_duration = 0;
  CodecContextPtr m_videoCodec;
  SwsContext *m_sws = nullptr;
  bool m_hardwareDecoding = true;
  bool m_tlsVerify = true;
  std::string m_inputOptions;
  ByteSourceFactory m_sourceFactory;
  std::mutex m_sourceMutex;             // m_source: set by the demux thread, aborted by the destructor
  std::unique_ptr<ByteSource> m_source; // the input's custom IO, if any (m_avio reads from it)
  AVIOContext *m_avio = nullptr;
  bool m_loaded = false;
  MediaInfo m_info;

  // Decode thread: serial of the packets being decoded, and the seek target still to reach.
  int m_decodeSerial = 0;
  double m_decodeTarget = -1;

  PacketQueue m_videoPackets;
  PacketQueue m_audioPackets;
  FrameQueue m_frames;
  Clock m_clock;
  SeekState m_seek;
  std::mutex m_audioMutex; // guards m_audio, replaced by the demux thread on a track switch
  std::shared_ptr<AudioOutput> m_audio;
  std::atomic<bool> m_videoEnded{false};
  std::atomic<double> m_position{0}; // seconds from the start of what is on screen

  // Demux thread: loop timestamp shift, end of the latest packet (shifted), end of input reached.
  int64_t m_offsetUs = 0;
  int64_t m_endUs = 0;
  bool m_ended = false;

  std::mutex m_requestMutex;
  std::optional<double> m_seekRequest;
  std::optional<int> m_trackRequest;

  // Startup timeline, ms since Open, logged once the first frame is on screen. The demux thread writes the stages
  // up to the decoder before it starts the decode and render threads; the decode thread writes firstFrame before
  // queueing that frame, which the render thread pops before it reads it.
  struct Startup {
    std::chrono::steady_clock::time_point opened;
    double input = 0, probe = 0, decoder = 0, audio = 0, firstFrame = 0;
    std::string decoderName;
    std::string source; // for the log, without the query (tokens)
  } m_startup;
  // Perfetto tracks (Trace.h), made in Open before the threads start. m_startupTraced: the startup span has ended
  // (render thread; the destructor ends it after joining, if the first frame never came).
  std::unique_ptr<PlayerTracks> m_tracks;
  bool m_startupTraced = false;
  std::atomic<bool> m_seekTraced{false}; // a seek span is open (begun by the demux thread, ended by the render one)

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
