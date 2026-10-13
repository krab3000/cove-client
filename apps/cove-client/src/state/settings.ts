import { proxy } from 'valtio';

/** Where Settings were opened from: Back's label, and what a tablet shows beside it. */
export type SettingsFrom = 'library' | 'signIn' | 'player';

/** Whether the device's Settings (design turn 7) are open, over everything else, and from where. */
export const settingsScreen = proxy({
  open: false,
  from: 'library' as SettingsFrom,
  // A tablet's section (it keeps the last one)
  section: 0,
});

export function openSettings(from: SettingsFrom) {
  settingsScreen.from = from;
  settingsScreen.open = true;
}

export function closeSettings() {
  settingsScreen.open = false;
}
