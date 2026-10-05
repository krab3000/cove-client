import { Platform, useWindowDimensions } from 'react-native';
import { isLarge } from '../theme/layout';
import { useSystemInsets, type SystemInsets } from './systemInsets';

/**
 * The room the system bars and the camera cutout take from each edge, in dp: measured (the app's own Android module),
 * else the one table of guesses (a build without the module). Nothing elsewhere.
 */
export function useSafeInsets(): SystemInsets {
  const measured = useSystemInsets();
  const window = useWindowDimensions();
  return measured ?? guess(window.width, window.height);
}

function guess(width: number, height: number): SystemInsets {
  if (Platform.OS !== 'android')
    return { top: 0, right: 0, bottom: 0, left: 0 };
  // Upright: the status bar and the navigation bar
  if (width <= height) return { top: 36, right: 0, bottom: 48, left: 0 };
  // A phone sideways: the cutout on either side; a tablet: its taskbar
  return isLarge(width, height)
    ? { top: 28, right: 0, bottom: 16, left: 0 }
    : { top: 28, right: 40, bottom: 12, left: 40 };
}
