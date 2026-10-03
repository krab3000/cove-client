#include "pch.h"

#include "AudioOutput.h"

#include <Audioclient.h>
#include <mmdeviceapi.h>
#include <ksmedia.h>

#include <algorithm>

namespace ReactNativeLibav {

namespace {
constexpr REFERENCE_TIME kBufferDuration = 2'000'000; // 200 ms, in 100 ns units
}

AudioOutput::AudioOutput(AVStream *stream, PacketQueue &packets, Clock &clock, const SeekState &seek,
                         std::function<void(std::string)> onError)
    : m_stream(stream), m_packets(packets), m_clock(clock), m_seek(seek), m_onError(std::move(onError)) {
  m_serial = seek.serial;
  m_target = seek.target;
}

AudioOutput::~AudioOutput() {
  Stop();
  swr_free(&m_swr);
  av_channel_layout_uninit(&m_swrLayout);
  av_channel_layout_uninit(&m_outLayout);
}

void AudioOutput::Stop() {
  m_stop = true;
  m_cv.notify_all();
  if (m_thread.joinable())
    m_thread.join();
}

bool AudioOutput::Start() {
  const AVCodec *decoder = avcodec_find_decoder(m_stream->codecpar->codec_id);
  if (!decoder)
    return false;
  m_codec.reset(avcodec_alloc_context3(decoder));
  if (!m_codec || avcodec_parameters_to_context(m_codec.get(), m_stream->codecpar) < 0)
    return false;
  m_codec->pkt_timebase = m_stream->time_base;
  if (avcodec_open2(m_codec.get(), decoder, nullptr) < 0)
    return false;
  m_thread = std::thread([this] { Run(); });
  return true;
}

void AudioOutput::SetPaused(bool paused) {
  m_paused = paused;
  m_cv.notify_all();
}

void AudioOutput::Run() {
  SetThreadDescription(GetCurrentThread(), L"libav audio");
  winrt::init_apartment(winrt::apartment_type::multi_threaded);
  try {
    Play();
  } catch (const winrt::hresult_error &e) {
    m_failed = true;
    if (m_onError)
      m_onError("Audio output failed: " + winrt::to_string(e.message()));
  }
  winrt::uninit_apartment();
}

void AudioOutput::Play() {
  auto enumerator = winrt::create_instance<IMMDeviceEnumerator>(__uuidof(MMDeviceEnumerator));
  winrt::com_ptr<IMMDevice> device;
  winrt::check_hresult(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, device.put()));
  winrt::com_ptr<IAudioClient> client;
  winrt::check_hresult(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, client.put_void()));

  WAVEFORMATEX *mix = nullptr;
  winrt::check_hresult(client->GetMixFormat(&mix));
  m_outRate = int(mix->nSamplesPerSec);
  m_outChannels = mix->nChannels;
  DWORD mask = mix->wFormatTag == WAVE_FORMAT_EXTENSIBLE ? reinterpret_cast<WAVEFORMATEXTENSIBLE *>(mix)->dwChannelMask : 0;
  CoTaskMemFree(mix);
  if (!mask || av_channel_layout_from_mask(&m_outLayout, mask) < 0 || m_outLayout.nb_channels != m_outChannels)
    av_channel_layout_default(&m_outLayout, m_outChannels);

  // Float32 at the mix rate and channel count: the engine mixes in this format, so no conversion on its side.
  WAVEFORMATEXTENSIBLE format{};
  format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
  format.Format.nChannels = WORD(m_outChannels);
  format.Format.nSamplesPerSec = DWORD(m_outRate);
  format.Format.wBitsPerSample = 32;
  format.Format.nBlockAlign = WORD(m_outChannels * 4);
  format.Format.nAvgBytesPerSec = format.Format.nSamplesPerSec * format.Format.nBlockAlign;
  format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
  format.Samples.wValidBitsPerSample = 32;
  format.dwChannelMask = mask;
  format.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
  winrt::check_hresult(client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                          AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                                              AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                                          kBufferDuration, 0, &format.Format, nullptr));
  winrt::handle event{CreateEventW(nullptr, FALSE, FALSE, nullptr)};
  winrt::check_hresult(client->SetEventHandle(event.get()));
  UINT32 bufferFrames = 0;
  winrt::check_hresult(client->GetBufferSize(&bufferFrames));
  // Samples leave our buffer this long before they are heard (audio engine and device).
  REFERENCE_TIME streamLatency = 0;
  client->GetStreamLatency(&streamLatency);
  const double latency = streamLatency / 1e7;
  winrt::com_ptr<IAudioRenderClient> render;
  winrt::check_hresult(client->GetService(IID_PPV_ARGS(render.put())));

  bool running = false;
  while (!m_stop) {
    if (const int serial = m_seek.serial; serial != m_serial) {
      // Seeked: drop what the device still holds, and everything decoded, before playing from the new position.
      if (running) {
        client->Stop();
        running = false;
      }
      client->Reset();
      Flush();
      m_serial = serial;
      m_target = m_seek.target;
    }
    if (m_paused) {
      if (running) {
        client->Stop(); // keeps what is buffered: resume continues exactly where it stopped
        running = false;
      }
      std::unique_lock lock(m_mutex);
      m_cv.wait_for(lock, std::chrono::milliseconds(50), [&] { return m_stop || !m_paused; });
      continue;
    }

    UINT32 padding = 0;
    winrt::check_hresult(client->GetCurrentPadding(&padding));
    const UINT32 available = bufferFrames - padding;
    if (available > 0) {
      BYTE *data = nullptr;
      winrt::check_hresult(render->GetBuffer(available, &data));
      auto *out = reinterpret_cast<float *>(data);
      const float gain = m_muted ? 0.0f : std::clamp(m_volume.load(), 0.0f, 1.0f);
      const size_t wanted = size_t(available) * m_outChannels;
      size_t written = 0;
      while (written < wanted) {
        if (m_pendingPos >= m_pending.size() && !Refill())
          break;
        const size_t n = std::min(wanted - written, m_pending.size() - m_pendingPos);
        for (size_t i = 0; i < n; ++i)
          out[written + i] = m_pending[m_pendingPos + i] * gain;
        written += n;
        m_pendingPos += n;
      }
      const UINT32 silence = UINT32((wanted - written) / m_outChannels);
      std::fill(out + written, out + wanted, 0.0f);
      winrt::check_hresult(render->ReleaseBuffer(available, 0));

      if (written > 0) {
        // pts just past the last real sample handed over, minus what the device still has before it.
        const double end = m_pendingPts + double(m_pendingPos / m_outChannels) / m_outRate;
        const double buffered = double(padding + available - silence) / m_outRate;
        m_clock.Set(end - buffered - latency, m_serial);
      } else if (m_decoderEnded && padding == 0) {
        m_finished = true;
      }
    }
    if (!running) {
      winrt::check_hresult(client->Start());
      running = true;
    }
    WaitForSingleObject(event.get(), 100);
  }
  client->Stop();
}

bool AudioOutput::Refill() {
  FramePtr frame{av_frame_alloc()};
  for (;;) {
    const int ret = avcodec_receive_frame(m_codec.get(), frame.get());
    if (ret == 0) {
      if (Convert(frame.get()))
        return true;
      continue;
    }
    if (ret == AVERROR_EOF) {
      m_draining = false;
      avcodec_flush_buffers(m_codec.get());
      if (!m_loopFlush) {
        m_decoderEnded = true;
        return false;
      }
      m_loopFlush = false;
    } else if (ret != AVERROR(EAGAIN)) {
      return false;
    }
    if (m_draining)
      continue;

    auto item = m_packets.TryPop();
    if (!item)
      return false;
    if (item->serial != m_serial)
      continue; // from before a seek
    switch (item->kind) {
      case PacketItem::Kind::Data:
        avcodec_send_packet(m_codec.get(), item->packet.get()); // a corrupt packet is not fatal
        break;
      case PacketItem::Kind::Flush:
      case PacketItem::Kind::End:
        m_loopFlush = item->kind == PacketItem::Kind::Flush;
        m_draining = true;
        avcodec_send_packet(m_codec.get(), nullptr);
        break;
    }
  }
}

bool AudioOutput::Convert(const AVFrame *frame) {
  if (!m_swr || frame->format != m_swrFormat || frame->sample_rate != m_swrRate ||
      av_channel_layout_compare(&frame->ch_layout, &m_swrLayout) != 0) {
    swr_free(&m_swr);
    if (swr_alloc_set_opts2(&m_swr, &m_outLayout, AV_SAMPLE_FMT_FLT, m_outRate, &frame->ch_layout,
                            AVSampleFormat(frame->format), frame->sample_rate, 0, nullptr) < 0 ||
        swr_init(m_swr) < 0) {
      swr_free(&m_swr);
      return false;
    }
    m_swrFormat = frame->format;
    m_swrRate = frame->sample_rate;
    av_channel_layout_uninit(&m_swrLayout);
    av_channel_layout_copy(&m_swrLayout, &frame->ch_layout);
  }
  const int maxOut = swr_get_out_samples(m_swr, frame->nb_samples);
  if (maxOut <= 0)
    return false;
  m_pending.resize(size_t(maxOut) * m_outChannels);
  auto *out = reinterpret_cast<uint8_t *>(m_pending.data());
  const int count = swr_convert(m_swr, &out, maxOut, frame->extended_data, frame->nb_samples);
  if (count <= 0)
    return false;
  m_pending.resize(size_t(count) * m_outChannels);
  m_pendingPos = 0;
  m_pendingPts = frame->best_effort_timestamp != AV_NOPTS_VALUE
      ? frame->best_effort_timestamp * av_q2d(m_stream->time_base)
      : m_nextPts;
  m_nextPts = m_pendingPts + double(count) / m_outRate;
  if (m_target >= 0) {
    // After a seek the decoder starts at a keyframe before the target: skip up to the target itself.
    if (m_nextPts <= m_target)
      return false;
    if (m_pendingPts < m_target)
      m_pendingPos = size_t((m_target - m_pendingPts) * m_outRate) * m_outChannels;
    m_target = -1;
  }
  return true;
}

void AudioOutput::Flush() {
  avcodec_flush_buffers(m_codec.get());
  swr_free(&m_swr);
  m_swrFormat = -1;
  m_pending.clear();
  m_pendingPos = 0;
  m_draining = false;
  m_loopFlush = false;
  m_decoderEnded = false;
  m_finished = false;
}

} // namespace ReactNativeLibav
