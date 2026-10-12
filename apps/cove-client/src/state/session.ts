import { AppState } from 'react-native';
import { proxy, ref } from 'valtio';
import { CoveClient, authFailure } from '../api/cove';
import { bindMediaAuth } from '../platform/player';
import { withAccount, withServer } from './signIn';
import { accounts, changeAccounts, hydrateAccounts } from './accounts';
import { player } from './player';
import { hydratePrefs } from './prefs';

export type SessionStatus = 'hydrating' | 'resuming' | 'signedOut' | 'signedIn';

/**
 * The session the app is in: reading what was kept, resuming the last session, signed out (signing in), or signed in
 * with a client. Signing in opens on signInServerId's accounts (the server last signed out of, or whose session
 * didn't resume).
 */
export const session = proxy({
  status: 'hydrating' as SessionStatus,
  client: null as CoveClient | null,
  serverId: null as string | null,
  signInServerId: undefined as string | undefined,
});

/** At launch: what was kept, then the session the app was in, if it is still good. */
export async function startSession() {
  await Promise.all([hydrateAccounts(), hydratePrefs()]);
  const { servers, last } = accounts;
  const server = servers.find((s) => s.id === last?.serverId);
  const account = server?.accounts.find((a) => a.username === last?.username);
  session.signInServerId = last?.serverId;
  if (!server || !account?.refreshToken) {
    session.status = 'signedOut';
    return;
  }
  session.status = 'resuming';
  try {
    enter(
      await CoveClient.resume(
        server.address,
        account.username,
        account.refreshToken
      ),
      server.id
    );
  } catch (e) {
    // Ran out: the account asks for its password; offline: it is tried again from the list
    if (authFailure(e) === 'expired')
      changeAccounts((state) =>
        withServer(state, server.id, (x) =>
          withAccount(x, account.username, null)
        )
      );
    session.signInServerId = server.id;
    session.status = 'signedOut';
  }
}

// Undoes what enter() set up for the session in use: its media auth binding and foreground listener.
let unbindSession: (() => void) | null = null;

/** Signed in: the session is kept (its refresh token follows every rotation) and resumes on the next launch. */
export function enter(client: CoveClient, serverId: string) {
  unbindSession?.();
  const unbindMedia = bindMediaAuth(client);
  // Back in front: timers did not run in the background, so a token that ran out is renewed now.
  const foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') client.renewIfExpiring().catch(() => {});
  });
  unbindSession = () => {
    foreground.remove();
    unbindMedia();
    client.dispose(); // its renewal timer stops with it
  };
  client.onRefreshToken = (refreshToken) =>
    changeAccounts((state) =>
      withServer(state, serverId, (server) =>
        withAccount(server, client.username, refreshToken)
      )
    );
  changeAccounts((state) => ({
    ...withServer(state, serverId, (server) => ({
      ...withAccount(server, client.username, client.currentRefreshToken),
      lastReached: Date.now(),
    })),
    last: { serverId, username: client.username },
  }));
  session.client = ref(client);
  session.serverId = serverId;
  session.status = 'signedIn';
}

/** Log out: the session ends (on the server too); the account stays on the device, asking for its password. */
export function logout() {
  const { client, serverId } = session;
  if (!client || !serverId) return;
  client.onRefreshToken = null;
  unbindSession?.();
  unbindSession = null;
  client.logout();
  changeAccounts((state) => ({
    ...withServer(state, serverId, (server) =>
      withAccount(server, client.username, null)
    ),
    last: null,
  }));
  player.playing = null;
  session.signInServerId = serverId;
  session.client = null;
  session.serverId = null;
  session.status = 'signedOut';
}
