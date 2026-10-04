import { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { CoveClient } from './api/cove';
import type { Video } from './api/types';
import { colors } from './components/Controls';
import { BrowseScreen } from './screens/BrowseScreen';
import { LoginScreen } from './screens/LoginScreen';
import { PlayerScreen } from './screens/PlayerScreen';

export default function App() {
  const [client, setClient] = useState<CoveClient | null>(null);
  const [playing, setPlaying] = useState<Video | null>(null);

  const logout = useCallback(() => {
    client?.logout();
    setPlaying(null);
    setClient(null);
  }, [client]);
  const closePlayer = useCallback(() => setPlaying(null), []);

  return (
    <View style={styles.app}>
      <View style={styles.content}>
        {!client ? (
          <LoginScreen onLogin={setClient} />
        ) : (
          <>
            {/* The grid stays mounted under the player, so going back keeps the scroll position. */}
            <BrowseScreen
              client={client}
              onPlay={setPlaying}
              onLogout={logout}
            />
            {playing ? (
              <PlayerScreen
                client={client}
                video={playing}
                onClose={closePlayer}
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.background,
    // Android 15 draws edge to edge: keep clear of the status and navigation bars.
    ...(Platform.OS === 'android' && { paddingTop: 36, paddingBottom: 48 }),
  },
  content: { flex: 1 },
});
