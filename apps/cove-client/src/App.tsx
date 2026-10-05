import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { CoveClient } from './api/cove';
import type { Video } from './api/types';
import { colors } from './components/Controls';
import { BrowseScreen } from './screens/BrowseScreen';
import { LoginScreen } from './screens/LoginScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { useSystemInsets } from './systemInsets';

export default function App() {
  const [client, setClient] = useState<CoveClient | null>(null);
  const window = useWindowDimensions();
  const bars = useSystemInsets();
  const sideways = window.width > window.height;
  // A phone held sideways has its camera cutout on a side; a tablet's is in the bezel.
  const phone = Math.min(window.width, window.height) < 600;
  // The video playing and the ones after it (the player's Up next); Autoplay plays the next one at the end.
  const [playing, setPlaying] = useState<{
    video: Video;
    upNext: Video[];
    startAt?: number;
  } | null>(null);
  const [autoplay, setAutoplay] = useState(true);
  const play = useCallback(
    (video: Video, upNext: Video[], startAt?: number) =>
      setPlaying({ video, upNext, startAt }),
    []
  );

  const logout = useCallback(() => {
    client?.logout();
    setPlaying(null);
    setClient(null);
  }, [client]);
  const closePlayer = useCallback(() => setPlaying(null), []);

  return (
    <View style={styles.app}>
      <View
        style={[
          styles.content,
          bars
            ? {
                paddingTop: bars.top,
                paddingRight: bars.right,
                paddingBottom: bars.bottom,
                paddingLeft: bars.left,
              }
            : Platform.OS === 'android' &&
              (!sideways
                ? styles.androidUpright
                : phone
                  ? styles.androidSideways
                  : styles.androidTablet),
        ]}
      >
        {!client ? (
          <LoginScreen onLogin={setClient} />
        ) : (
          // The grid stays mounted under the player, so going back keeps the scroll position.
          <BrowseScreen
            client={client}
            onPlay={play}
            onLogout={logout}
            // No previews under the player: the hardware decoder is shared, and a 4K stream needs all of it.
            previews={!playing}
          />
        )}
      </View>
      {/* Edge to edge, outside the content's system bar padding: the player keeps its own insets. */}
      {client && playing ? (
        <PlayerScreen
          // A new video is a new player (its own state, session and resume position).
          key={playing.video.id}
          client={client}
          video={playing.video}
          upNext={playing.upNext}
          onPlayNext={play}
          autoplay={autoplay}
          onAutoplay={setAutoplay}
          onClose={closePlayer}
          startAt={playing.startAt}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  // Android draws edge to edge: the content keeps clear of the system bars and the camera cutout by their measured
  // sizes. Guesses for a build without the module that measures them.
  androidUpright: { paddingTop: 36, paddingBottom: 48 },
  androidSideways: { paddingTop: 28, paddingBottom: 12, paddingHorizontal: 40 },
  androidTablet: { paddingTop: 28, paddingBottom: 16 },
});
