import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { LibavVideoView, type LibavVideoViewHandle } from 'react-native-libav';
import type { CoveClient } from '../api/cove';
import type { Video } from '../api/types';

// Where the full video is sampled when there is no generated preview clip (fractions of its duration).
const STOPS = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
const STOP_SECONDS = 2.5;

/**
 * A muted preview over a card while it is hovered: Cove's generated preview clip when the video has one,
 * otherwise the video itself, hopping through it so the preview shows more than the intro.
 */
export function HoverPreview({
  client,
  video,
}: {
  client: CoveClient;
  video: Video;
}) {
  const player = useRef<LibavVideoViewHandle>(null);
  const [source, setSource] = useState<{ uri: string; clip: boolean } | null>(
    null
  );
  const [duration, setDuration] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    client.previewAvailable(video).then((clip) => {
      if (alive)
        setSource({
          uri: clip ? client.previewUrl(video) : client.streamUrl(video),
          clip,
        });
    });
    return () => {
      alive = false;
    };
  }, [client, video]);

  // The full video: hop to the next stop every few seconds.
  useEffect(() => {
    if (!source || source.clip || !duration) return;
    let stop = 0;
    const timer = setInterval(() => {
      stop = (stop + 1) % STOPS.length;
      player.current?.seek(duration * STOPS[stop]!);
    }, STOP_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [source, duration]);

  if (!source) return null;
  return (
    <LibavVideoView
      ref={player}
      // Hidden until the first frame, so the thumbnail stays up while it loads.
      style={[StyleSheet.absoluteFill, !visible && styles.hidden]}
      source={source.uri}
      muted
      loop
      // See PlayerScreen: FFmpeg's revocation check fails behind TLS-inspecting antivirus.
      tlsVerify={false}
      onLoad={(e) => {
        if (!source.clip) {
          setDuration(e.nativeEvent.duration);
          player.current?.seek(e.nativeEvent.duration * STOPS[0]!);
        } else {
          setVisible(true);
        }
      }}
      onSeek={() => setVisible(true)}
    />
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
});
