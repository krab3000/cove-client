import { StyleSheet, View } from 'react-native';
import { nocturne as n } from '../theme/tokens';

/**
 * Nocturne's switch, 44×26: on, an accent 30% track with an accent ring and an accent-200 knob at the right; off, a
 * neutral track with a divider ring. Only the look: the row it sits in takes the press.
 */
export function Switch({ on }: { on: boolean }) {
  return (
    <View style={[styles.track, on ? styles.trackOn : styles.trackOff]}>
      <View style={[styles.knob, on ? styles.knobOn : styles.knobOff]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 44,
    height: 26,
    padding: 3,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackOn: {
    justifyContent: 'flex-end',
    backgroundColor: n.accentAlpha(30),
    borderColor: n.accent,
  },
  trackOff: {
    justifyContent: 'flex-start',
    backgroundColor: n.neutral800,
    borderColor: n.divider,
  },
  knob: { width: 18, height: 18, borderRadius: 9 },
  knobOn: { backgroundColor: n.accent200 },
  knobOff: { backgroundColor: '#9397ab' }, // neutral-400
});
