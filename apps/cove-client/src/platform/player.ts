import { createElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MpvVideoViewProps } from 'react-native-mpv';
import type { CoveClient } from '../api/cove';

/**
 * Platforms without a player yet (Windows: mpv comes there later, see TODO.md). Same exports as player.android.ts,
 * so the screens compile and run unchanged; VideoView shows a notice instead of the video.
 */

export type {
  MpvVideoViewHandle as VideoViewHandle,
  LoadEvent,
} from 'react-native-mpv';

export function bindMediaAuth(_client: CoveClient): () => void {
  return () => {};
}

export function prefetchMedia(_urls: string[]): void {}

export function VideoView({ style }: MpvVideoViewProps) {
  return createElement(
    View,
    { style: [styles.box, style] },
    createElement(
      Text,
      { style: styles.text },
      "Playback isn't available on this platform yet"
    )
  );
}

export const playerEngine = 'none';

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  text: { color: '#aaa', fontSize: 14 },
});
