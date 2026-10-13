#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include <functional>
#include <vector>

#include "ByteSource.h"

struct mpv_handle;

namespace ReactNativeMpv {

struct AudioTrackInfo {
  int index = -1; // the stream's index in the file (mpv's ff-index)
  std::string language;
  std::string title;
  std::string codec;
  int channels = 0;
  int sampleRate = 0;
};

struct SubtitleTrackInfo {
  int index = -1; // the stream's index in the file (mpv's ff-index)
  std::string language;
  std::string title;
  std::string codec; // subrip, ass, mov_text, hdmv_pgs_subtitle, dvd_subtitle, ...
  bool isDefault = false; // the file's default flag
  bool forced = false;
};

struct MediaInfo {
  double duration = 0;
  int width = 0;
  int height = 0;
  double aspect = 0; // display aspect ratio
  bool hasAudio = false;
  bool hwDecoding = false;
  std::string codec;
  std::vector<AudioTrackInfo> audioTracks;
  int audioTrack = -1;
  std::vector<SubtitleTrackInfo> subtitleTracks;
  int subtitleTrack = -1; // the one shown, -1 for none
};

// Called on mpv's event thread.
struct PlayerCallbacks {
  std::function<void(const MediaInfo &)> onLoad;
  std::function<void(double currentTime, double duration)> onProgress;
  std::function<void(double currentTime)> onSeek;
  std::function<void()> onEnd;
  std::function<void(const std::string &)> onError;
};

// The player behind an MpvVideoView: libmpv, built by scripts/mpv-android against this package's FFmpeg and loaded
// at run time (dlopen).
//
// http(s) sources are read through the C++ RAM/disk cache: libmpv's stream callbacks (mpv_stream_cb_add_ro, protocol
// covecache://) over a ByteSource (CachedHttpSource), so mpv's demuxer reads from the cache with no HTTP in between.
// debug input=url lets mpv open the URL itself (its own HTTP).
//
// Video: vo=gpu (OpenGL ES on the window, wid: the Surface) with hwdec=mediacodec where mpv decodes the codec in
// hardware, software decoding otherwise.
//
// Debug switches (adb shell setprop debug.mpv.<name> <value>), read at each open: vo (embed: vo=mediacodec_embed,
// hardware-decoded video only), input (url), readahead (demuxer-readahead-secs, default 5), max_bytes (MiB, default
// 32), log (mpv's log level to logcat, tag "mpv", default warn), stats (1: playback time, A/V sync and dropped frames
// once a second).
class MpvPlayer {
 public:
  // Whether libmpv.so is there (loaded on first call).
  static bool Available();
  // Fonts for subtitles (libass has no system font provider on Android): a directory of font files and the family
  // to use when a subtitle's own is not there. Set once, before the first Open.
  static void SetSubtitleFonts(std::string dir, std::string family);

  // wid: the window, as mpv's "wid" option takes it (Android: a JNI global reference to the Surface, kept alive by
  // the caller until this player is gone). width/height: the surface's size (for vo=gpu).
  MpvPlayer(int64_t wid, int width, int height, PlayerCallbacks callbacks);
  ~MpvPlayer();

  void Open(std::string source, bool hardwareDecoding, int audioTrack);
  // The Surface's size changed (vo=gpu draws at it).
  void SetSurfaceSize(int width, int height);
  void SetPaused(bool paused);
  void SetMuted(bool muted);
  void SetVolume(float volume);
  void SetLoop(bool loop);
  void SetSpeed(double speed);
  void SetTlsVerify(bool verify) noexcept { m_tlsVerify = verify; }
  void SetByteSourceFactory(ByteSourceFactory factory) { m_sourceFactory = std::move(factory); }
  void Seek(double seconds);
  void SetAudioTrack(int index); // FFmpeg stream index, -1 for the default
  // FFmpeg stream index, kSubtitleDefault for the file's default (mpv's choice), kSubtitleOff for none.
  void SetSubtitleTrack(int index);
  static constexpr int kSubtitleDefault = -1;
  static constexpr int kSubtitleOff = -2;

 private:
  struct Stream;
  void Events();
  void Loaded();
  void SetOption(const char *name, const std::string &value);
  void SetProperty(const char *name, const std::string &value);
  void Command(std::initializer_list<const char *> args);
  void SelectTrack(const char *type, const char *property, int streamIndex);
  double PropertyDouble(const char *name, double fallback = 0) const;
  void LogStartup(const char *stage);
  double SinceOpen() const;
  static int OpenStream(void *user, char *uri, void *info);

  mpv_handle *m_mpv = nullptr;
  PlayerCallbacks m_callbacks;
  ByteSourceFactory m_sourceFactory;
  bool m_tlsVerify = true;
  bool m_hardwareDecoding = true;
  bool m_embedded = false; // vo=mediacodec_embed (debug.mpv.vo=embed), else vo=gpu
  int m_width = 0, m_height = 0;
  int64_t m_wid = 0;
  std::thread m_events;
  std::atomic<bool> m_quit{false};

  std::mutex m_mutex; // guards the URLs, the latest stream and the pending tracks
  std::map<std::string, std::string> m_urls; // covecache://<n> -> URL
  int m_nextUrl = 0;
  Stream *m_stream = nullptr; // the latest one opened (for the startup log's cache summary)
  int m_pendingAudio = -1;
  int m_pendingSubtitle = kSubtitleDefault;

  // Event thread state.
  std::string m_label;
  std::chrono::steady_clock::time_point m_openedAt;
  std::atomic<bool> m_loaded{false}; // also read by SetAudioTrack/SetSubtitleTrack (caller's thread)
  bool m_reconfigured = false, m_restarted = false, m_ended = false;
  std::atomic<bool> m_seeking{false}; // set by Seek, cleared by the event thread
  std::atomic<bool> m_loop{false};
  double m_duration = 0;
  double m_lastProgress = -1;
  std::chrono::steady_clock::time_point m_lastProgressAt;
  double m_loadedMs = 0, m_reconfigMs = 0;
  uint64_t m_track = 0;
};

} // namespace ReactNativeMpv
