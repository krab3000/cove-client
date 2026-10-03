#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>

#include "FFmpeg.h"

namespace ReactNativeLibav {

// A demuxed packet, or a marker in the packet stream:
//   Flush: the demuxer looped back to the start; drain and flush the decoder, timestamps continue monotonically.
//   End:   end of input; drain the decoder.
// serial counts seeks (and audio track switches): a decoder seeing a new serial flushes, and anything carrying an
// older one is stale.
struct PacketItem {
  enum class Kind { Data, Flush, End };
  Kind kind = Kind::Data;
  PacketPtr packet;
  int serial = 0;
};

// Where playback restarts after the latest seek: the decoders drop what comes before target (stream seconds).
// Writers set target, then bump serial; readers that see a new serial read the target that goes with it.
struct SeekState {
  std::atomic<int> serial{0};
  std::atomic<double> target{-1};
};

// Decoded frames carry the serial of the packets they came from in AVFrame::opaque.
inline int FrameSerial(const AVFrame *frame) noexcept {
  return int(reinterpret_cast<intptr_t>(frame->opaque));
}
inline void SetFrameSerial(AVFrame *frame, int serial) noexcept {
  frame->opaque = reinterpret_cast<void *>(intptr_t(serial));
}

// Thread-safe FIFO. Push blocks while the queue is at capacity; everything returns early once aborted.
template <typename T>
class BlockingQueue {
 public:
  explicit BlockingQueue(size_t capacity = SIZE_MAX) : m_capacity(capacity) {}

  bool Push(T item) {
    std::unique_lock lock(m_mutex);
    m_notFull.wait(lock, [&] { return m_aborted || m_items.size() < m_capacity; });
    if (m_aborted)
      return false;
    m_items.push_back(std::move(item));
    m_notEmpty.notify_one();
    return true;
  }

  std::optional<T> Pop(std::chrono::milliseconds timeout) {
    std::unique_lock lock(m_mutex);
    if (!m_notEmpty.wait_for(lock, timeout, [&] { return m_aborted || !m_items.empty(); }) || m_aborted)
      return std::nullopt;
    return TakeFront();
  }

  std::optional<T> TryPop() {
    std::lock_guard lock(m_mutex);
    if (m_aborted || m_items.empty())
      return std::nullopt;
    return TakeFront();
  }

  size_t Size() const {
    std::lock_guard lock(m_mutex);
    return m_items.size();
  }

  // Drops everything queued (a seek), unblocking a full queue's producer.
  void Clear() {
    std::lock_guard lock(m_mutex);
    m_items.clear();
    m_notFull.notify_all();
  }

  void Abort() {
    std::lock_guard lock(m_mutex);
    m_aborted = true;
    m_items.clear();
    m_notEmpty.notify_all();
    m_notFull.notify_all();
  }

 private:
  T TakeFront() {
    T item = std::move(m_items.front());
    m_items.pop_front();
    m_notFull.notify_one();
    return item;
  }

  mutable std::mutex m_mutex;
  std::condition_variable m_notEmpty;
  std::condition_variable m_notFull;
  std::deque<T> m_items;
  size_t m_capacity;
  bool m_aborted = false;
};

using PacketQueue = BlockingQueue<PacketItem>;
using FrameQueue = BlockingQueue<FramePtr>;

} // namespace ReactNativeLibav
