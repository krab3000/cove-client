import { proxy, snapshot, subscribe } from 'valtio';
import type { SignIn } from '../signIn';
import { readItem, readLegacy, writeItem } from './storage';

const KEY = 'cove/accounts/v1';

/** The servers added and the accounts (sessions) kept for them on this device; persisted on every change. */
export const accounts = proxy<SignIn>({ servers: [], last: null });

/** A change as a pure function of the state (the signIn.ts helpers); the store takes the result. */
export function changeAccounts(change: (state: SignIn) => SignIn) {
  // Plain copies in, so the store owns its objects (snapshots are frozen)
  const next = JSON.parse(
    JSON.stringify(change(snapshot(accounts) as SignIn))
  ) as SignIn;
  accounts.servers = next.servers;
  accounts.last = next.last;
}

/** Reads what was kept (or, once, what an older build kept), then writes every change straight away. */
export async function hydrateAccounts() {
  let json = await readItem(KEY);
  if (!json) {
    json = readLegacy('signIn');
    if (json) writeItem(KEY, json);
  }
  if (json) {
    try {
      const kept = JSON.parse(json) as SignIn;
      if (Array.isArray(kept.servers)) {
        accounts.servers = kept.servers;
        accounts.last = kept.last ?? null;
      }
    } catch {}
  }
  // At once, not debounced: a refresh token that rotated must survive the app being killed
  subscribe(accounts, () => writeItem(KEY, JSON.stringify(snapshot(accounts))));
}
