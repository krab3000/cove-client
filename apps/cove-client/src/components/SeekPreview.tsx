import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { VideoView, type VideoViewHandle } from '../player';
import type { CoveClient, SpriteSheet } from '../api/cove';
import type { Video } from '../api/types';
import { formatDuration } from '../format';
import { colors } from './Controls';

const WIDTH = 240;
// The fallback player seeks at most this often while the pointer moves (plus once where it stops).
const SEEK_INTERVAL_MS = 120;

/**
 * The frame at a time on the seek bar: a cell of Cove's sprite sheet when the video has one, otherwise a paused
 * second player that seeks to the time (hardware decoding makes that quick enough to follow the pointer).
 */
export function SeekPreview({
  client,
  video,
  sprite,
  time,
  label,
  left,
  aspect,
  visible,
}: {
  client: CoveClient;
  video: Video;
  sprite: SpriteSheet | null;
  time: number; // in the file
  label: number; // shown under the frame
  left: number; // centre of the popup, in the parent's coordinates
  aspect: number; // width / height
  // Kept mounted while hidden, so the fallback player stays open between hovers.
  visible: boolean;
}) {
  const cue =
    sprite?.cues.find((c) => time >= c.start && time < c.end) ??
    sprite?.cues[sprite.cues.length - 1];
  const frameAspect = cue ? cue.w / cue.h : aspect > 0 ? aspect : 16 / 9;
  const height = Math.round(WIDTH / frameAspect);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.popup,
        { left: left - WIDTH / 2, width: WIDTH },
        !visible && styles.hidden,
      ]}
    >
      <View style={[styles.frame, { height }]}>
        {sprite && cue ? (
          <SpriteFrame sprite={sprite} cue={cue} width={WIDTH} />
        ) : (
          <PlayerFrame client={client} video={video} time={time} />
        )}
      </View>
      <Text style={styles.time}>{formatDuration(label)}</Text>
    </View>
  );
}

function SpriteFrame({
  sprite,
  cue,
  width,
}: {
  sprite: SpriteSheet;
  cue: SpriteSheet['cues'][number];
  width: number;
}) {
  const scale = width / cue.w;
  return (
    <Image
      source={{ uri: sprite.url }}
      style={{
        position: 'absolute',
        left: -cue.x * scale,
        top: -cue.y * scale,
        width: sprite.width * scale,
        height: sprite.height * scale,
      }}
    />
  );
}

function PlayerFrame({
  client,
  video,
  time,
}: {
  client: CoveClient;
  video: Video;
  time: number;
}) {
  const player = useRef<VideoViewHandle>(null);
  const [loaded, setLoaded] = useState(false);
  const lastSeek = useRef(0);
  const trailing = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const seek = () => {
      lastSeek.current = Date.now();
      player.current?.seek(time);
    };
    if (trailing.current) clearTimeout(trailing.current);
    const wait = SEEK_INTERVAL_MS - (Date.now() - lastSeek.current);
    if (wait <= 0) seek();
    else trailing.current = setTimeout(seek, wait);
    return () => {
      if (trailing.current) clearTimeout(trailing.current);
    };
  }, [time, loaded]);

  return (
    <VideoView
      ref={player}
      style={StyleSheet.absoluteFill}
      source={client.streamUrl(video)}
      paused
      muted
      tlsVerify={false}
      onLoad={() => setLoaded(true)}
    />
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  popup: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: 8,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    backgroundColor: '#000',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  time: {
    color: colors.text,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
    overflow: 'hidden',
  },
});
