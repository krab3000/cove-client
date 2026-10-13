#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "ByteSource.h"
#include "Player.h"

struct mpv_handle;

namespace ReactNativeLibav {

// The second engine behind a LibavVideoView (its `engine` prop: "mpv"): libmpv, built by scripts/mpv-android against
// this package's FFmpeg, loaded at run time (dlopen: debug builds ship libmpv.so, release builds don't; without it
// Available() is false and the view stays on Player). Same callbacks and MediaInfo as Player.
//
// http(s) sources are read through the same ByteSourceFactory as Player's (the C++ RAM/disk cache): libmpv's stream
// callbacks (mpv_stream_cb_add_ro, protocol covecache://) over a ByteSource, so mpv's demuxer reads from the cache
// with no HTTP in between. debug.libav.mpv_input=url lets mpv open the URL itself (its own HTTP).
//
// Video: vo=gpu (OpenGL ES on the window, wid: the Surface) with hwdec=mediacodec where mpv decodes the codec in
// hardware, software decoding otherwise. Debug switches (adb shell setprop debug.libav.<name>): mpv_vo (embed:
// vo=mediacodec_embed, hardware-decoded video only), mpv_input (url), mpv_readahead (demuxer-readahead-secs, default
// 5), mpv_max_bytes (MiB, default 32), mpv_log (mpv's log level to logcat, tag "mpv", default warn).
class MpvPlayer {
 public:
  // Whether libmpv.so is there (loaded on first call).
  static bool Available();

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
  void SetTlsVerify(bool verify) noexcept { m_tlsVerify = verify; }
  void SetByteSourceFactory(ByteSourceFactory factory) { m_sourceFactory = std::move(factory); }
  void Seek(double seconds);
  void SetAudioTrack(int index); // FFmpeg stream index (as Player's), -1 for the default

 private:
  struct Stream;
  void Events();
  void Loaded();
  void SetOption(const char *name, const std::string &value);
  void SetProperty(const char *name, const std::string &value);
  void Command(std::initializer_list<const char *> args);
  void SelectAudio(int streamIndex);
  double PropertyDouble(const char *name, double fallback = 0) const;
  void LogStartup(const char *stage);
  double SinceOpen() const;
  static int OpenStream(void *user, char *uri, void *info);

  mpv_handle *m_mpv = nullptr;
  PlayerCallbacks m_callbacks;
  ByteSourceFactory m_sourceFactory;
  bool m_tlsVerify = true;
  bool m_hardwareDecoding = true;
  bool m_embedded = false; // vo=mediacodec_embed (debug.libav.mpv_vo=embed), else vo=gpu
  int m_width = 0, m_height = 0;
  int64_t m_wid = 0;
  std::thread m_events;
  std::atomic<bool> m_quit{false};

  std::mutex m_mutex; // guards the URLs, the latest stream and m_pendingAudio
  std::map<std::string, std::string> m_urls; // covecache://<n> -> URL
  int m_nextUrl = 0;
  Stream *m_stream = nullptr; // the latest one opened (for the startup log's cache summary)
  int m_pendingAudio = -1;

  // Event thread state.
  std::string m_label;
  std::chrono::steady_clock::time_point m_openedAt;
  std::atomic<bool> m_loaded{false}; // also read by SetAudioTrack (caller's thread)
  bool m_reconfigured = false, m_restarted = false, m_ended = false;
  std::atomic<bool> m_seeking{false}; // set by Seek, cleared by the event thread
  std::atomic<bool> m_loop{false};
  double m_duration = 0;
  double m_lastProgress = -1;
  std::chrono::steady_clock::time_point m_lastProgressAt;
  double m_loadedMs = 0, m_reconfigMs = 0;
  uint64_t m_track = 0;
};

} // namespace ReactNativeLibav
