import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { CoveClient, SpriteSheet } from '../../../api/cove';
import type { Video } from '../../../api/types';
import { VideoView } from '../../../platform/player';
import { nocturne as n } from '../../../theme/tokens';
import { SpriteCell } from './SpriteCell';

// Phones and tablets: no sprite-sheet fallback. A sheet is one 2880×1620 JPEG (19 MB decoded) for a 300 px frame;
// a few of them fill the image cache and starve a weak device's memory and GPU.
const SPRITE_FALLBACK = Platform.OS !== 'android';

// Frames shown, spread evenly over the video, and how long each stays.
const FRAMES = 12;
const FRAME_MS = 600;
// The first and last frames are often titles or black: skip that much of each end.
const SKIP_ENDS = 0.03;

/**
 * The preview over a card (hovered on the desktop; on a phone, the card in the middle of the screen, or one pressed
 * and held): Cove's preview clip, muted and looping, like video sites do. The clip is short and low resolution, so
 * it is cheap to play; the player stays transparent until its first frame, so the cover shows until the clip
 * plays. A video without a clip flips through frames of its sprite sheet instead (SpritePreview).
 */
export function HoverPreview({
  client,
  video,
  width,
  height,
  onState,
}: {
  client: CoveClient;
  video: Video;
  width: number;
  height: number;
  // 'playing' once something moves on the card; 'none' when the video has no preview of either kind.
  onState?: (state: 'playing' | 'none') => void;
}) {
  const [clip, setClip] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    client.previewAvailable(video).then((has) => {
      if (!alive) return;
      setClip(has);
      if (!has && !SPRITE_FALLBACK) onState?.('none');
    });
    return () => {
      alive = false;
    };
  }, [client, video]);

  if (clip === null) return null;
  if (!clip && !SPRITE_FALLBACK) return null;
  if (!clip)
    return (
      <SpritePreview
        client={client}
        video={video}
        width={width}
        height={height}
        onState={onState}
      />
    );
  return (
    <VideoView
      style={StyleSheet.absoluteFill}
      source={client.previewUrl(video)}
      muted
      loop
      // Android: plays the clip from a local copy (downloaded once, or prefetched by the grid): a sub-megabyte
      // clip downloads in one request, while streaming it costs several HTTPS round trips and a buffer.
      cache
      // See PlayerScreen: the player's own TLS check fails here, the app's fetch already checked the server.
      tlsVerify={false}
      // The first progress report: frames are on screen.
      onProgress={() => onState?.('playing')}
      onError={() => onState?.('none')}
    />
  );
}

/**
 * Frames from across the video, one after another, with a thin bar telling how far into the video each one is.
 * The frames are cells of Cove's sprite sheet: one image download per video and no decoding. A video without a
 * sprite sheet keeps its cover. The cover stays until the sheet has loaded.
 */
function SpritePreview({
  client,
  video,
  width,
  height,
  onState,
}: {
  client: CoveClient;
  video: Video;
  width: number;
  height: number;
  onState?: (state: 'playing' | 'none') => void;
}) {
  const [sprite, setSprite] = useState<SpriteSheet | null>(null);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let alive = true;
    client.spriteSheet(video).then((sheet) => {
      if (!alive) return;
      setSprite(sheet);
      if (!sheet) onState?.('none');
    });
    return () => {
      alive = false;
    };
  }, [client, video]);

  const cues = useMemo(() => {
    const all = sprite?.cues ?? [];
    if (all.length <= FRAMES) return all;
    const from = Math.floor(all.length * SKIP_ENDS);
    const span = all.length - 2 * from;
    return Array.from(
      { length: FRAMES },
      (_, i) => all[from + Math.floor(((i + 0.5) * span) / FRAMES)]!
    );
  }, [sprite]);

  useEffect(() => {
    if (!ready || cues.length < 2) return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % cues.length),
      FRAME_MS
    );
    return () => clearInterval(timer);
  }, [ready, cues.length]);

  const cue = cues[frame];
  if (!sprite || !cue) return null;
  const last = sprite.cues[sprite.cues.length - 1]!;
  const duration = last.end > 0 ? last.end : 1;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, !ready && styles.hidden]}
    >
      <SpriteCell
        sprite={sprite}
        cue={cue}
        width={width}
        height={height}
        onLoad={() => {
          setReady(true);
          onState?.('playing');
        }}
      />
      <View style={styles.track}>
        <View
          style={[
            styles.progress,
            { width: `${Math.min(1, cue.end / duration) * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  progress: { height: '100%', backgroundColor: n.accent },
});
