import { Platform, StyleSheet } from 'react-native';
import NativeSmoothEdges from '../native/SmoothEdgesNativeComponent';

/**
 * Windows: anti-aliased rounded corners for the tree this is mounted in (see SmoothEdgesNativeComponent). Renders
 * nothing that takes space; nothing at all elsewhere. One at the app's root and one in each Modal.
 */
export function SmoothEdges() {
  return Platform.OS === 'windows' ? (
    <NativeSmoothEdges style={styles.none} pointerEvents="none" />
  ) : null;
}

const styles = StyleSheet.create({
  none: { position: 'absolute', width: 0, height: 0 },
});
