import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSnapshot } from 'valtio';
import { createQueryClient } from './app/queryClient';
import { useSafeInsets } from './platform/insets';
import { BrowseScreen } from './screens/BrowseScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SignInScreen } from './features/signin/SignInScreen';
import { closePlayer, play, player } from './state/player';
import { prefs } from './state/prefs';
import { logout, session, startSession } from './state/session';
import { nocturne } from './theme/tokens';
import { Spinner } from './ui/Text';
import { ClientContext } from './data/client';

/**
 * The app's shell: what was kept is read and the last session resumed (a spinner meanwhile), then signing in or the
 * Library, with the player over the Library when a video plays. The Library stays mounted under the player, so going
 * back keeps its scroll position.
 */
export default function App() {
  // Snapshots re-render on change; the client and the videos are plain objects (ref), passed as they are
  const sessionSnap = useSnapshot(session);
  const { status } = sessionSnap;
  const client = sessionSnap.client ? session.client : null;
  const playing = useSnapshot(player).playing ? player.playing : null;
  const { autoplay } = useSnapshot(prefs);

  useEffect(() => {
    startSession();
  }, []);
  // A new session starts with an empty cache
  const queryClient = useMemo(() => createQueryClient(), [client]);
  // Android draws edge to edge: the content keeps clear of the system bars and the camera cutout
  const insets = useSafeInsets();

  return (
    <QueryClientProvider client={queryClient}>
      <ClientContext.Provider value={client}>
        <View style={styles.app}>
          <View
            style={[
              styles.content,
              {
                paddingTop: insets.top,
                paddingRight: insets.right,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
              },
            ]}
          >
            {status === 'hydrating' || status === 'resuming' ? (
              <View style={styles.waiting}>
                <Spinner />
              </View>
            ) : status === 'signedIn' && client ? (
              <BrowseScreen
                client={client}
                onPlay={play}
                onLogout={logout}
                // No previews under the player: the hardware decoder is shared, and a 4K stream needs all of it.
                previews={!playing}
              />
            ) : (
              <SignInScreen />
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
              onAutoplay={(on) => {
                prefs.autoplay = on;
              }}
              onClose={closePlayer}
              startAt={playing.startAt}
            />
          ) : null}
        </View>
      </ClientContext.Provider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: nocturne.bg },
  content: { flex: 1 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
