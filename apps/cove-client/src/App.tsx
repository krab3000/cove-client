import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { CoveClient, CoveError } from './api/cove';
import type { Video } from './api/types';
import { colors } from './components/Controls';
import { BrowseScreen } from './screens/BrowseScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { SignInScreen } from './screens/SignInScreen';
import {
  loadSignIn,
  saveSignIn,
  withAccount,
  withServer,
  type SignIn,
} from './signIn';
import { useSystemInsets } from './systemInsets';

export default function App() {
  // The servers and the sessions kept on this device (persisted), and the session the app is in
  const [signIn, setSignIn] = useState<SignIn>(loadSignIn);
  const changeSignIn = useCallback((change: (state: SignIn) => SignIn) => {
    setSignIn((state) => {
      const next = change(state);
      saveSignIn(next);
      return next;
    });
  }, []);
  const [session, setSession] = useState<{
    client: CoveClient;
    serverId: string;
  } | null>(null);
  const client = session?.client ?? null;
  // Where signing in opens: the accounts of the server last signed out of (or whose session didn't resume)
  const [signInServer, setSignInServer] = useState<string | undefined>(
    () => loadSignIn().last?.serverId
  );
  // Signed in: the session is kept (its refresh token follows every rotation) and resumes on the next launch.
  const enter = useCallback(
    (signedIn: CoveClient, serverId: string) => {
      const keep = (refreshToken: string | null) =>
        changeSignIn((state) =>
          withServer(state, serverId, (server) =>
            withAccount(server, signedIn.username, refreshToken)
          )
        );
      signedIn.onRefreshToken = keep;
      changeSignIn((state) => ({
        ...withServer(state, serverId, (server) => ({
          ...withAccount(
            server,
            signedIn.username,
            signedIn.currentRefreshToken
          ),
          lastReached: Date.now(),
        })),
        last: { serverId, username: signedIn.username },
      }));
      setSession({ client: signedIn, serverId });
    },
    [changeSignIn]
  );
  // On launch, the session the app was in, if it is still good
  const [resuming, setResuming] = useState(() => {
    const { servers, last } = loadSignIn();
    const server = servers.find((s) => s.id === last?.serverId);
    return !!server?.accounts.find((a) => a.username === last?.username)
      ?.refreshToken;
  });
  useEffect(() => {
    if (!resuming) return;
    const { servers, last } = signIn;
    const server = servers.find((s) => s.id === last?.serverId);
    const account = server?.accounts.find((a) => a.username === last?.username);
    if (!server || !account?.refreshToken) {
      setResuming(false);
      return;
    }
    CoveClient.resume(server.address, account.username, account.refreshToken)
      .then((resumed) => enter(resumed, server.id))
      .catch((e) => {
        // Ran out: the account asks for its password; offline: it is tried again from the list
        if (e instanceof CoveError && (e.status === 401 || e.status === 409))
          changeSignIn((state) =>
            withServer(state, server.id, (x) =>
              withAccount(x, account.username, null)
            )
          );
        setSignInServer(server.id);
      })
      .finally(() => setResuming(false));
    // Once, at launch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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

  // Log out: the session ends (on the server too); the account stays on the device, asking for its password.
  const logout = useCallback(() => {
    if (!session) return;
    const { client: ending, serverId } = session;
    ending.onRefreshToken = null;
    ending.logout();
    changeSignIn((state) => ({
      ...withServer(state, serverId, (server) =>
        withAccount(server, ending.username, null)
      ),
      last: null,
    }));
    setSignInServer(serverId);
    setPlaying(null);
    setSession(null);
  }, [session, changeSignIn]);
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
        {resuming ? (
          <View style={styles.resuming}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : !client ? (
          <SignInScreen
            state={signIn}
            onChange={changeSignIn}
            onSignedIn={enter}
            initialServerId={signInServer}
          />
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
  resuming: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Android draws edge to edge: the content keeps clear of the system bars and the camera cutout by their measured
  // sizes. Guesses for a build without the module that measures them.
  androidUpright: { paddingTop: 36, paddingBottom: 48 },
  androidSideways: { paddingTop: 28, paddingBottom: 12, paddingHorizontal: 40 },
  androidTablet: { paddingTop: 28, paddingBottom: 16 },
});
