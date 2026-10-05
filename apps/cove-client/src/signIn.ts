/** An account signed in on this device: its session (Cove's refresh token), or null once it ran out or signed out. */
export interface KeptAccount {
  username: string;
  refreshToken: string | null;
}

/** A Cove server added to the list (design 1a), with the accounts kept for it (1b). */
export interface KeptServer {
  id: string;
  name: string;
  address: string;
  accounts: KeptAccount[];
  // When it last answered, ms since the epoch
  lastReached: number | null;
}

export interface SignIn {
  servers: KeptServer[];
  // The session the app was in: it resumes there on the next launch
  last: { serverId: string; username: string } | null;
}

/** What was typed as an address, as a base URL: https:// unless it says otherwise, no trailing slash. */
export function normalizeAddress(text: string): string {
  const trimmed = text.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

/** An address's host: the name of a server added without one. */
export function hostOf(address: string): string {
  return address.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[:/].*$/, '');
}

export function newServerId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The state with one server changed. */
export function withServer(
  state: SignIn,
  id: string,
  change: (server: KeptServer) => KeptServer
): SignIn {
  return {
    ...state,
    servers: state.servers.map((s) => (s.id === id ? change(s) : s)),
  };
}

/** A server with an account's session set (added if new, first in the list). */
export function withAccount(
  server: KeptServer,
  username: string,
  refreshToken: string | null
): KeptServer {
  const others = server.accounts.filter((a) => a.username !== username);
  const known = server.accounts.some((a) => a.username === username);
  const account = { username, refreshToken };
  return {
    ...server,
    accounts: known
      ? server.accounts.map((a) => (a.username === username ? account : a))
      : [...others, account],
  };
}
