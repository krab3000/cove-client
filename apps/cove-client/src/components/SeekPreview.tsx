import { StyleSheet, Text, View } from 'react-native';
import type { SpriteSheet } from '../api/cove';
import { formatDuration } from '../lib/format';
import { nocturne as n } from '../theme/tokens';
import { SpriteCell } from './SpriteCell';

const WIDTH = 240;

/**
 * The frame at a time on the seek bar: a cell of Cove's sprite sheet. A video without one gets the time only (a
 * second player seeking along was too costly).
 */
export function SeekPreview({
  sprite,
  time,
  label,
  left,
  visible,
}: {
  sprite: SpriteSheet | null;
  time: number; // in the file
  label: number; // shown under the frame
  left: number; // centre of the popup, in the parent's coordinates
  visible: boolean;
}) {
  const cue =
    sprite?.cues.find((c) => time >= c.start && time < c.end) ??
    sprite?.cues[sprite.cues.length - 1];
  const height = cue ? Math.round((WIDTH * cue.h) / cue.w) : 0;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.popup,
        { left: left - WIDTH / 2, width: WIDTH },
        !visible && styles.hidden,
      ]}
    >
      {sprite && cue ? (
        <View style={[styles.frame, { height }]}>
          <SpriteCell sprite={sprite} cue={cue} width={WIDTH} height={height} />
        </View>
      ) : null}
      <Text style={styles.time}>{formatDuration(label)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  popup: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: 8,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    backgroundColor: '#000',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: n.divider,
    overflow: 'hidden',
  },
  time: {
    color: n.text,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
    overflow: 'hidden',
  },
});
