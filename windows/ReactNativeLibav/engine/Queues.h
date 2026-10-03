#pragma once

#include <chrono>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <optional>

#include "FFmpeg.h"

namespace ReactNativeLibav {

// A demuxed packet, or a marker in the packet stream:
//   Flush: the demuxer looped back to the start; drain and flush the decoder, timestamps continue monotonically.
//   End:   end of input; drain the decoder.
struct PacketItem {
  enum class Kind { Data, Flush, End };
  Kind kind = Kind::Data;
  PacketPtr packet;
};

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
