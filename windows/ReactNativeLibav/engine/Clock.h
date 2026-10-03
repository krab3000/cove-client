#pragma once

#include <chrono>
#include <mutex>
#include <optional>

namespace ReactNativeLibav {

// The playback (master) clock in media seconds. The audio output sets it as it feeds the device; without audio
// the renderer anchors it to the first frame. Between updates it runs on the system clock unless paused.
// A seek resets it to unset for a new serial; updates for any other serial (stale audio) are ignored.
class Clock {
 public:
  void Set(double pts, int serial) {
    std::lock_guard lock(m_mutex);
    if (serial != m_serial)
      return;
    m_pts = pts;
    m_at = Now();
    m_valid = true;
  }

  std::optional<double> Get() const {
    std::lock_guard lock(m_mutex);
    if (!m_valid)
      return std::nullopt;
    return m_paused ? m_pts : m_pts + (Now() - m_at);
  }

  void Reset(int serial) {
    std::lock_guard lock(m_mutex);
    m_serial = serial;
    m_valid = false;
  }

  int Serial() const {
    std::lock_guard lock(m_mutex);
    return m_serial;
  }

  void SetPaused(bool paused) {
    std::lock_guard lock(m_mutex);
    if (paused == m_paused)
      return;
    if (m_valid && paused)
      m_pts += Now() - m_at;
    m_at = Now();
    m_paused = paused;
  }

  bool Paused() const {
    std::lock_guard lock(m_mutex);
    return m_paused;
  }

 private:
  static double Now() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
  }

  mutable std::mutex m_mutex;
  double m_pts = 0;
  double m_at = 0;
  bool m_valid = false;
  int m_serial = 0;
  bool m_paused = false;
};

} // namespace ReactNativeLibav
