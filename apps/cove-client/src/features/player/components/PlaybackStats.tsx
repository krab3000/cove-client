import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  getHttpCacheStats,
  type HttpCacheStats,
  type LoadEvent,
} from '../../../platform/player';
import { fonts, overVideo } from '../../../theme/tokens';

const MB = 1 << 20;

/**
 * Settings → Playback statistics: over the video's top left, what plays (codec, size, hardware or software decoding)
 * and how it streams (the cache's RAM and disk, what was fetched and how fast), once a second.
 */
export function PlaybackStats({
  info,
  at,
}: {
  info: LoadEvent | null;
  // Where it goes over the video
  at: { top: number; left: number };
}) {
  const [stats, setStats] = useState<HttpCacheStats | null>(null);
  // The fetch totals a second ago: the rate is the difference
  const last = useRef<{ bytes: number; at: number } | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const ask = () =>
      getHttpCacheStats()
        .then((s) => {
          if (!alive || !s) return;
          const now = Date.now();
          const prev = last.current;
          if (prev && now > prev.at)
            setRate(((s.fetchedBytes - prev.bytes) / (now - prev.at)) * 1000);
          last.current = { bytes: s.fetchedBytes, at: now };
          setStats(s);
        })
        .catch(() => {});
    ask();
    const timer = setInterval(ask, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const mb = (bytes: number) =>
    `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
  const lines = [
    info
      ? `${info.codec || '?'} · ${info.width}×${info.height} · ${info.hwDecoding ? 'hardware' : 'software'} decoding`
      : 'Opening…',
    info?.audioTracks.length
      ? `audio ${info.audioTracks.length} · subtitles ${info.subtitleTracks.length}`
      : null,
    stats
      ? `cache: RAM ${mb(stats.ramBytes)} of ${mb(stats.ramLimit)} · disk ${stats.disk.enabled ? mb(stats.disk.bytes) : 'off'}`
      : null,
    stats
      ? `fetched ${mb(stats.fetchedBytes)} in ${stats.fetches} requests${rate != null ? ` · now ${(rate / MB).toFixed(1)} MB/s` : ''}`
      : null,
    stats && (stats.inFlight || stats.failed)
      ? `in flight ${stats.inFlight} · failed ${stats.failed}`
      : null,
  ].filter(Boolean) as string[];
  return (
    <View style={[styles.box, at]} pointerEvents="none">
      {lines.map((l) => (
        <Text key={l} style={styles.line} numberOfLines={1}>
          {l}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    maxWidth: '70%',
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 1,
    borderRadius: 6,
    backgroundColor: overVideo.badge,
  },
  line: {
    color: overVideo.ink,
    fontSize: 10.5,
    lineHeight: 14,
    fontFamily: fonts.mono,
  },
});
