#include "pch.h"

#include <Audioclient.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>

#include <condition_variable>
#include <future>
#include <mutex>
#include <thread>

#include "AudioDevice.h"
#include "Platform.h"

namespace ReactNativeLibav {

namespace {

constexpr REFERENCE_TIME kBufferDuration = 2'000'000; // 200 ms, in 100 ns units

// The default render endpoint in shared, event-driven mode, float32 at the mix rate and channel count (the engine
// mixes in this format, so it does no conversion). Everything WASAPI runs on the device's own MTA thread.
class WasapiAudioDevice final : public AudioDevice {
 public:
  WasapiAudioDevice() {
    std::promise<void> opened;
    auto result = opened.get_future();
    m_thread = std::thread([this, &opened] { Run(opened); });
    try {
      result.get(); // rethrows when the device cannot be opened
    } catch (...) {
      m_thread.join();
      throw;
    }
  }

  ~WasapiAudioDevice() override {
    Stop();
  }

  Format GetFormat() const override {
    return m_format;
  }

  void Start(Source source) override {
    std::lock_guard lock(m_mutex);
    m_source = std::move(source);
    m_cv.notify_all();
  }

  void SetPaused(bool paused) override {
    m_paused = paused;
    m_cv.notify_all();
  }

  void Stop() override {
    m_stop = true;
    m_cv.notify_all();
    if (m_thread.joinable())
      m_thread.join();
  }

  bool Failed() const override {
    return m_failed;
  }

 private:
  void Run(std::promise<void> &opened) {
    SetThreadName("libav audio");
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    try {
      Open();
      opened.set_value();
    } catch (const winrt::hresult_error &e) {
      opened.set_exception(std::make_exception_ptr(std::runtime_error(winrt::to_string(e.message()))));
      winrt::uninit_apartment();
      return;
    }
    try {
      Play();
    } catch (const winrt::hresult_error &e) {
      m_failed = true;
      Log("audio output failed: " + winrt::to_string(e.message()));
    }
    m_render = nullptr;
    m_client = nullptr;
    winrt::uninit_apartment();
  }

  void Open() {
    auto enumerator = winrt::create_instance<IMMDeviceEnumerator>(__uuidof(MMDeviceEnumerator));
    winrt::com_ptr<IMMDevice> device;
    winrt::check_hresult(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.put()));
    winrt::check_hresult(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, m_client.put_void()));

    WAVEFORMATEX *mix = nullptr;
    winrt::check_hresult(m_client->GetMixFormat(&mix));
    m_format.sampleRate = int(mix->nSamplesPerSec);
    m_format.channels = mix->nChannels;
    m_format.channelMask =
        mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE ? reinterpret_cast<WAVEFORMATEXTENSIBLE *>(mix)->dwChannelMask : 0;
    CoTaskMemFree(mix);

    WAVEFORMATEXTENSIBLE format{};
    format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
    format.Format.nChannels = WORD(m_format.channels);
    format.Format.nSamplesPerSec = DWORD(m_format.sampleRate);
    format.Format.wBitsPerSample = 32;
    format.Format.nBlockAlign = WORD(m_format.channels * 4);
    format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
    format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
    format.Samples.wValidBitsPerSample = 32;
    format.dwChannelMask = DWORD(m_format.channelMask);
    format.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
    winrt::check_hresult(m_client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                              AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                                                  AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                                              kBufferDuration, 0, &format.Format, nullptr));
    m_event.attach(CreateEventW(nullptr, FALSE, FALSE, nullptr));
    winrt::check_hresult(m_client->SetEventHandle(m_event.get()));
    winrt::check_hresult(m_client->GetBufferSize(&m_bufferFrames));
    winrt::check_hresult(m_client->GetService(IID_PPV_ARGS(m_render.put())));
    // Samples leave our buffer this long before they are heard (audio engine and device).
    REFERENCE_TIME latency = 0;
    m_client->GetStreamLatency(&latency);
    m_latency = latency / 1e7;
  }

  void Play() {
    bool running = false;
    bool flush = false;
    while (!m_stop) {
      Source source;
      {
        std::unique_lock lock(m_mutex);
        if (!m_source || m_paused) {
          if (running) {
            m_client->Stop(); // keeps what is buffered: resume continues exactly where it stopped
            running = false;
          }
          m_cv.wait_for(lock, std::chrono::milliseconds(50), [&] { return m_stop || (m_source && !m_paused); });
          continue;
        }
        source = m_source;
      }
      if (flush) {
        // A seek: drop what the device still holds (Reset needs the stream stopped).
        if (running) {
          m_client->Stop();
          running = false;
        }
        m_client->Reset();
        flush = false;
      }

      UINT32 padding = 0;
      winrt::check_hresult(m_client->GetCurrentPadding(&padding));
      const UINT32 available = m_bufferFrames - padding;
      if (available > 0) {
        BYTE *data = nullptr;
        winrt::check_hresult(m_render->GetBuffer(available, &data));
        auto *out = reinterpret_cast<float *>(data);
        const double delay = double(padding) / m_format.sampleRate + m_latency;
        size_t written = source(out, available, delay, flush);
        if (flush)
          written = 0; // the source reset its position: this buffer is not played
        std::fill(out + written * m_format.channels, out + size_t(available) * m_format.channels, 0.0f);
        winrt::check_hresult(m_render->ReleaseBuffer(written || !flush ? available : 0, 0));
        if (flush)
          continue;
      }
      if (!running) {
        winrt::check_hresult(m_client->Start());
        running = true;
      }
      WaitForSingleObject(m_event.get(), 100);
    }
    m_client->Stop();
  }

  std::thread m_thread;
  std::mutex m_mutex;
  std::condition_variable m_cv;
  Source m_source;
  std::atomic<bool> m_stop{false};
  std::atomic<bool> m_paused{false};
  std::atomic<bool> m_failed{false};

  Format m_format;
  winrt::com_ptr<IAudioClient> m_client;
  winrt::com_ptr<IAudioRenderClient> m_render;
  winrt::handle m_event;
  UINT32 m_bufferFrames = 0;
  double m_latency = 0;
};

} // namespace

std::unique_ptr<AudioDevice> CreateAudioDevice() {
  return std::make_unique<WasapiAudioDevice>();
}

} // namespace ReactNativeLibav
