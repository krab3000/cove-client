#include <aaudio/AAudio.h>

#include <algorithm>
#include <atomic>
#include <ctime>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>

#include "AudioDevice.h"
#include "Platform.h"

namespace ReactNativeLibav {

namespace {

int64_t MonotonicNs() {
  timespec ts{};
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return int64_t(ts.tv_sec) * 1'000'000'000 + ts.tv_nsec;
}

// AAudio output stream, float32 stereo at the device's native rate, with a data callback. The delay until a
// buffer is heard comes from the stream's presentation timestamps. When the route changes (headphones, Bluetooth)
// the stream is disconnected and gets reopened on the new default device.
class AAudioDevice final : public AudioDevice {
 public:
  AAudioDevice() {
    std::lock_guard lock(m_streamMutex);
    Open();
  }

  ~AAudioDevice() override {
    Stop();
  }

  Format GetFormat() const override {
    return m_format;
  }

  void Start(Source source) override {
    std::lock_guard lock(m_streamMutex);
    m_source = std::move(source);
    if (m_stream && !m_paused)
      AAudioStream_requestStart(m_stream);
  }

  void SetPaused(bool paused) override {
    m_paused = paused;
    std::lock_guard lock(m_streamMutex);
    if (!m_stream || !m_source)
      return;
    if (paused)
      AAudioStream_requestPause(m_stream); // keeps what is buffered
    else
      AAudioStream_requestStart(m_stream);
  }

  void Stop() override {
    m_stopped = true;
    if (m_reopenThread.joinable())
      m_reopenThread.join();
    std::lock_guard lock(m_streamMutex);
    Close();
  }

  bool Failed() const override {
    return m_failed;
  }

 private:
  void Open() {
    AAudioStreamBuilder *builder = nullptr;
    if (AAudio_createStreamBuilder(&builder) != AAUDIO_OK)
      throw std::runtime_error("AAudio is not available");
    AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
    AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
    AAudioStreamBuilder_setChannelCount(builder, 2);
    AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_SHARED);
    AAudioStreamBuilder_setPerformanceMode(builder, AAUDIO_PERFORMANCE_MODE_NONE); // video playback: power over latency
    AAudioStreamBuilder_setDataCallback(builder, &AAudioDevice::OnData, this);
    AAudioStreamBuilder_setErrorCallback(builder, &AAudioDevice::OnError, this);
    const aaudio_result_t result = AAudioStreamBuilder_openStream(builder, &m_stream);
    AAudioStreamBuilder_delete(builder);
    if (result != AAUDIO_OK) {
      m_stream = nullptr;
      throw std::runtime_error(std::string("cannot open the audio output: ") + AAudio_convertResultToText(result));
    }
    m_format.sampleRate = AAudioStream_getSampleRate(m_stream);
    m_format.channels = AAudioStream_getChannelCount(m_stream);
    m_format.channelMask = 0;
  }

  void Close() {
    if (!m_stream)
      return;
    AAudioStream_requestStop(m_stream);
    AAudioStream_close(m_stream); // no callbacks after this
    m_stream = nullptr;
  }

  static aaudio_data_callback_result_t OnData(AAudioStream *stream, void *user, void *audioData, int32_t frames) {
    auto *self = static_cast<AAudioDevice *>(user);
    auto *out = static_cast<float *>(audioData);
    const int rate = self->m_format.sampleRate;
    // Frame number `written` (the first of this buffer) is heard (written - presented) frames after the frame
    // presented at timeNs.
    double delay = double(AAudioStream_getBufferSizeInFrames(stream)) / rate;
    int64_t presented = 0, timeNs = 0;
    if (AAudioStream_getTimestamp(stream, CLOCK_MONOTONIC, &presented, &timeNs) == AAUDIO_OK) {
      const int64_t written = AAudioStream_getFramesWritten(stream);
      delay = std::max(0.0, double(written - presented) / rate - double(MonotonicNs() - timeNs) / 1e9);
    }
    bool flush = false; // a seek: the buffer is short, what it holds just plays out
    size_t filled = self->m_source ? self->m_source(out, size_t(frames), delay, flush) : 0;
    if (flush)
      filled = 0;
    std::fill(out + filled * self->m_format.channels, out + size_t(frames) * self->m_format.channels, 0.0f);
    return AAUDIO_CALLBACK_RESULT_CONTINUE;
  }

  static void OnError(AAudioStream * /*stream*/, void *user, aaudio_result_t error) {
    auto *self = static_cast<AAudioDevice *>(user);
    if (error != AAUDIO_ERROR_DISCONNECTED || self->m_stopped)
      return;
    // The stream cannot be closed from its own callback: reopen on another thread.
    if (self->m_reopenThread.joinable())
      self->m_reopenThread.detach(); // a previous reopen, finished
    self->m_reopenThread = std::thread([self] { self->Reopen(); });
  }

  void Reopen() {
    SetThreadName("libav audio");
    std::lock_guard lock(m_streamMutex);
    if (m_stopped)
      return;
    const int channels = m_format.channels;
    const int rate = m_format.sampleRate;
    Close();
    try {
      Open();
    } catch (const std::exception &e) {
      Log(e.what());
      m_failed = true;
      return;
    }
    if (m_format.channels != channels || m_format.sampleRate != rate) {
      // The source resamples to the format it got at the start.
      Log("audio output format changed after a route change");
      Close();
      m_failed = true;
      return;
    }
    if (m_source && !m_paused)
      AAudioStream_requestStart(m_stream);
  }

  std::mutex m_streamMutex;
  AAudioStream *m_stream = nullptr;
  Source m_source;
  Format m_format;
  std::thread m_reopenThread;
  std::atomic<bool> m_paused{false};
  std::atomic<bool> m_stopped{false};
  std::atomic<bool> m_failed{false};
};

} // namespace

std::unique_ptr<AudioDevice> CreateAudioDevice() {
  return std::make_unique<AAudioDevice>();
}

} // namespace ReactNativeLibav
