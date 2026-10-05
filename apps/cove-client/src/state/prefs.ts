import { proxy, snapshot, subscribe } from 'valtio';
import type { LibraryView } from '../components/LibraryHeader';
import { readItem, writeItem } from './storage';

const KEY = 'cove/prefs/v1';

/** The user's choices that outlive a session: the Library's view, the player's Autoplay. */
export const prefs = proxy({
  libraryView: 'grid3' as LibraryView,
  autoplay: true,
});

export async function hydratePrefs() {
  const json = await readItem(KEY);
  if (json) {
    try {
      Object.assign(prefs, JSON.parse(json));
    } catch {}
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  subscribe(prefs, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => writeItem(KEY, JSON.stringify(snapshot(prefs))),
      500
    );
  });
}
