#include "AudioOutput.h"

#include <algorithm>

#include "Platform.h"

namespace ReactNativeLibav {

AudioOutput::AudioOutput(AVStream *stream, PacketQueue &packets, Clock &clock, const SeekState &seek)
    : m_stream(stream), m_packets(packets), m_clock(clock), m_seek(seek) {
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
  if (m_device)
    m_device->Stop();
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

  try {
    m_device = CreateAudioDevice();
  } catch (const std::exception &e) {
    Log(std::string("audio output unavailable: ") + e.what());
    return false;
  }
  const AudioDevice::Format format = m_device->GetFormat();
  m_outRate = format.sampleRate;
  m_outChannels = format.channels;
  if (!format.channelMask || av_channel_layout_from_mask(&m_outLayout, format.channelMask) < 0 ||
      m_outLayout.nb_channels != m_outChannels)
    av_channel_layout_default(&m_outLayout, m_outChannels);

  m_device->SetPaused(m_paused);
  m_device->Start([this](float *out, size_t frames, double delay, bool &flush) {
    return Render(out, frames, delay, flush);
  });
  return true;
}

void AudioOutput::SetPaused(bool paused) {
  m_paused = paused;
  if (m_device)
    m_device->SetPaused(paused);
}

size_t AudioOutput::Render(float *out, size_t frames, double delay, bool &flush) {
  if (const int serial = m_seek.serial; serial != m_serial) {
    // Seeked: drop everything decoded, and what the device still holds, before playing from the new position.
    Flush();
    m_serial = serial;
    m_target = m_seek.target;
    flush = true;
    return 0;
  }

  const float gain = m_muted ? 0.0f : std::clamp(m_volume.load(), 0.0f, 1.0f);
  const size_t wanted = frames * size_t(m_outChannels);
  size_t written = 0;
  double startPts = -1;
  while (written < wanted) {
    if (m_pendingPos >= m_pending.size() && !Refill())
      break;
    if (startPts < 0)
      startPts = m_pendingPts + double(m_pendingPos / m_outChannels) / m_outRate;
    const size_t n = std::min(wanted - written, m_pending.size() - m_pendingPos);
    for (size_t i = 0; i < n; ++i)
      out[written + i] = m_pending[m_pendingPos + i] * gain;
    written += n;
    m_pendingPos += n;
  }

  if (written > 0)
    m_clock.Set(startPts - delay, m_serial); // out[0] is heard delay seconds from now
  else if (m_decoderEnded && delay <= 0.001)
    m_finished = true;
  return written / size_t(m_outChannels);
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
