import { useEffect, useState } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

/** The room the system bars and the camera cutout take from each edge of the window, in dp. */
export interface SystemInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NONE: SystemInsets = { top: 0, right: 0, bottom: 0, left: 0 };

// The app's own Android module (SystemInsetsModule.kt); absent elsewhere and in builds older than it.
const native = NativeModules.SystemInsets as
  { get(): SystemInsets | null } | undefined;

/**
 * Android draws the app edge to edge: the status bar, the navigation bar or a tablet's taskbar, and the camera cutout
 * cover its edges. Their sizes, live (rotation, the taskbar stashed). No system bars over the window elsewhere; null
 * where they can't be read (an Android build without the module).
 */
export function useSystemInsets(): SystemInsets | null {
  const [insets, setInsets] = useState<SystemInsets | null>(
    () => native?.get() ?? null
  );
  useEffect(() => {
    if (!native) return;
    const sub = DeviceEventEmitter.addListener('systemInsets', setInsets);
    // Read again: the first read can come before the window is attached.
    setInsets(native.get() ?? null);
    return () => sub.remove();
  }, []);
  return Platform.OS === 'android' ? insets : NONE;
}
