import { Platform } from 'react-native';
import { proxy, snapshot, subscribe } from 'valtio';
import type { LibraryView } from '../features/library/components/LibraryHeader';
import { readItem, writeItem } from './storage';

const KEY = 'cove/prefs/v1';

export type PreviewMode = 'clip' | 'frames' | 'off';
export type PlayerLog = 'warn' | 'info' | 'v';

/**
 * The device's settings (design turn 7): kept on this device, for every account on it, and never sent to the server.
 * The defaults are what the app did before they could be changed.
 */
export const PREF_DEFAULTS = {
  // Playback
  autoplay: true,
  // Resume where the user left off (unless that was in the first seconds or the last 15)
  resume: true,
  // Seconds a skip button, or a double tap on either side, jumps
  seekStep: 10,
  // The player's controls hide after this long without input while playing; 0: never
  hideAfterMs: 3000,
  // The file's default subtitle track, or none
  subtitles: 'file' as 'file' | 'off',
  hardwareDecoding: true,
  // Library & previews
  libraryView: 'grid3' as LibraryView,
  // What a card plays when it previews: the preview clip, frames from the sprite sheet, or nothing
  previews: 'clip' as PreviewMode,
  // Rows of preview clips downloaded ahead of where the list moves (touch); 0: none
  preloadRows: 3,
  // Android decodes preview clips on the CPU: hardware decoders are few and slow to open
  previewHardware: Platform.OS !== 'android',
  // Streaming & cache (react-native-mpv's HTTP cache); -1: derived from the device
  memoryCacheMB: -1,
  diskCacheMB: -1,
  chunkKB: 1024,
  // Chunks fetched past the one playing
  readAhead: 2,
  // Android: Wi-Fi out of power saving while streaming
  wifiLock: true,
  // The player's own TLS check (the app's fetch checked the server at login): behind TLS-inspecting antivirus or a
  // user-installed CA it fails, so it is off unless asked for
  tlsVerify: false,
  // Diagnostics
  stats: false,
  playerLog: 'warn' as PlayerLog,
  networkLog: false,
};

export type Prefs = typeof PREF_DEFAULTS;

/** The user's choices that outlive a session: the device's settings, the Library's view, the player's Autoplay. */
export const prefs = proxy<Prefs>({ ...PREF_DEFAULTS });

/** Settings → Reset to defaults. */
export function resetPrefs() {
  Object.assign(prefs, PREF_DEFAULTS);
}

export async function hydratePrefs() {
  const json = await readItem(KEY);
  if (json) {
    try {
      const kept = JSON.parse(json) as Partial<Prefs>;
      // Only known keys, of the default's type: a value from an older or newer version is dropped
      for (const key of Object.keys(PREF_DEFAULTS) as (keyof Prefs)[])
        if (typeof kept[key] === typeof PREF_DEFAULTS[key])
          (prefs as Record<string, unknown>)[key] = kept[key];
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
