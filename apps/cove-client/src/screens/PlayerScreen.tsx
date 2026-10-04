import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { CoveClient, SpriteSheet } from '../api/cove';
import type { Video } from '../api/types';
import { Bar, Button, colors } from '../components/Controls';
import { SeekPreview } from '../components/SeekPreview';
import { formatDuration, videoTitle } from '../format';
import {
  playerEngine,
  VideoView,
  type LoadEvent,
  type VideoViewHandle,
} from '../player';

/**
 * Plays a video's original file, streamed from Cove over HTTP(S) range requests, in VideoView (libVLC on
 * Windows, libav on Android; hardware decoding). A clip (a video cut from another one) plays its parent's file
 * between clipStartSec and clipEndSec.
 */
export function PlayerScreen({
  client,
  video,
  onClose,
}: {
  client: CoveClient;
  video: Video;
  onClose: () => void;
}) {
  const player = useRef<VideoViewHandle>(null);
  const [info, setInfo] = useState<LoadEvent | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [time, setTime] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  // The pointer over the seek bar, for the preview above it (mounted from the first hover on).
  const [hover, setHover] = useState<{
    fraction: number;
    width: number;
  } | null>(null);
  const [hoveredOnce, setHoveredOnce] = useState(false);
  const [barWidth, setBarWidth] = useState(0);
  const [sprite, setSprite] = useState<SpriteSheet | null>(null);

  // Android's back gesture closes the player instead of the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    client.spriteSheet(video).then((sheet) => alive && setSprite(sheet));
    return () => {
      alive = false;
    };
  }, [client, video]);

  const clipStart = video.parentVideoId ? (video.clipStartSec ?? 0) : 0;
  const clipEnd = video.parentVideoId ? video.clipEndSec : null;
  const duration =
    clipEnd != null ? clipEnd - clipStart : (info?.duration ?? 0) - clipStart;
  // Times on screen are relative to the clip.
  const position = Math.max(0, (scrub ?? time) - clipStart);
  // Where the seek-bar preview shows: the drag position (touch, or a mouse drag), else the hovered one.
  const previewAt =
    scrub !== null && duration > 0
      ? Math.min(1, Math.max(0, (scrub - clipStart) / duration))
      : (hover?.fraction ?? null);

  const seek = (seconds: number) => {
    const t = clipStart + Math.min(Math.max(0, seconds), Math.max(0, duration));
    setTime(t);
    player.current?.seek(t);
  };

  return (
    <View style={styles.screen}>
      <VideoView
        ref={player}
        style={styles.video}
        source={client.streamUrl(video)}
        paused={paused}
        muted={muted}
        volume={volume}
        audioTrack={audioTrack}
        // FFmpeg's TLS check (schannel) insists on a revocation check, which fails behind TLS-inspecting
        // antivirus (the ESET SSL filter CA has no revocation list). The app's own fetch validated this server
        // through Windows at login, so the player skips its own check for it.
        tlsVerify={false}
        onLoad={(e) => {
          setInfo(e.nativeEvent);
          if (clipStart > 0) player.current?.seek(clipStart);
        }}
        onProgress={(e) => {
          if (scrub !== null) return;
          setTime(e.nativeEvent.currentTime);
          if (clipEnd != null && e.nativeEvent.currentTime >= clipEnd)
            setPaused(true);
        }}
        onSeek={(e) => setTime(e.nativeEvent.currentTime)}
        onEnd={() => setPaused(true)}
        onError={(e) => setError(e.nativeEvent.message)}
      />
      {!info && !error ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : null}

      <View style={styles.top}>
        <Button title="‹ Back" onPress={onClose} />
        <Text style={styles.title} numberOfLines={1}>
          {videoTitle(video)}
        </Text>
        {info ? (
          <Text style={styles.dim}>
            {info.codec} {info.width}×{info.height} ·{' '}
            {info.hwDecoding ? 'hardware' : 'software'} decode · {playerEngine}
          </Text>
        ) : null}
      </View>

      <View style={styles.controls}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          <Text style={styles.time}>{formatDuration(position)}</Text>
          {hoveredOnce && duration > 0 ? (
            <SeekPreview
              client={client}
              video={video}
              sprite={sprite}
              time={clipStart + (previewAt ?? 0) * duration}
              label={(previewAt ?? 0) * duration}
              left={TIME_WIDTH + ROW_GAP + (previewAt ?? 0) * barWidth}
              aspect={info && info.height > 0 ? info.width / info.height : 0}
              visible={previewAt !== null}
            />
          ) : null}
          <Bar
            onWidth={setBarWidth}
            onHover={(h) => {
              setHover(h);
              if (h) setHoveredOnce(true);
            }}
            value={duration > 0 ? position / duration : 0}
            onChange={(v) => {
              // Dragging (finger or mouse) only moves the bar and the preview; the seek happens on release.
              setScrub(clipStart + v * duration);
              setHoveredOnce(true);
            }}
            onRelease={(v) => {
              setScrub(null);
              seek(v * duration);
            }}
          />
          <Text style={styles.time}>{formatDuration(duration)}</Text>
        </View>
        <View style={styles.row}>
          <Button title="−10s" onPress={() => seek(position - 10)} />
          <Button
            title={paused ? 'Play' : 'Pause'}
            onPress={() => setPaused(!paused)}
          />
          <Button title="+10s" onPress={() => seek(position + 10)} />
          <Button
            title={muted ? 'Unmute' : 'Mute'}
            onPress={() => setMuted(!muted)}
          />
          <Bar value={volume} onChange={setVolume} width={120} />
          {info && info.audioTracks.length > 1
            ? info.audioTracks.map((t) => (
                <Button
                  key={t.index}
                  active={
                    (audioTrack === -1 ? info.audioTrack : audioTrack) ===
                    t.index
                  }
                  title={[t.language, t.title, `${t.channels}ch`]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={() => setAudioTrack(t.index)}
                />
              ))
            : null}
        </View>
      </View>
    </View>
  );
}

const TIME_WIDTH = 64;
const ROW_GAP = 10;

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  video: { flex: 1 },
  center: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  title: { color: colors.text, fontSize: 16, flexShrink: 1 },
  dim: { color: colors.textDim, marginLeft: 'auto' },
  controls: {
    padding: 12,
    gap: 10,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ROW_GAP,
    flexWrap: 'wrap',
  },
  time: { color: colors.textDim, width: TIME_WIDTH, textAlign: 'center' },
  error: { color: colors.error },
});
