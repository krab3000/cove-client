import { useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { nocturne as n } from '../theme/tokens';

// A horizontal bar showing value (0..1); press or drag to change it. onHover reports where the pointer is over it
// (0..1 and the bar's width in px), or null when it leaves.
export function Bar({
  value,
  onChange,
  onRelease,
  onHover,
  onWidth,
  width,
}: {
  value: number;
  onChange: (value: number) => void;
  onRelease?: (value: number) => void;
  onHover?: (hover: { fraction: number; width: number } | null) => void;
  onWidth?: (width: number) => void;
  width?: number;
}) {
  const [barWidth, setBarWidth] = useState(1);
  const at = (e: GestureResponderEvent) =>
    Math.min(1, Math.max(0, e.nativeEvent.locationX / barWidth));
  return (
    <View
      style={[styles.bar, width ? { width } : styles.barFill]}
      onLayout={(e) => {
        const w = Math.max(1, e.nativeEvent.layout.width);
        setBarWidth(w);
        onWidth?.(w);
      }}
      // A finger needs more than the 12 px bar to hit.
      hitSlop={{ top: 16, bottom: 16 }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => onChange(at(e))}
      onResponderMove={(e) => onChange(at(e))}
      onResponderRelease={(e) => onRelease?.(at(e))}
      onPointerMove={
        onHover &&
        ((e) =>
          onHover({
            fraction: Math.min(
              1,
              Math.max(0, e.nativeEvent.offsetX / barWidth)
            ),
            width: barWidth,
          }))
      }
      onPointerLeave={onHover && (() => onHover(null))}
    >
      <View
        pointerEvents="none"
        style={[
          styles.barValue,
          { width: `${Math.min(1, Math.max(0, value)) * 100}%` },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 12,
    backgroundColor: n.textAlpha(22),
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: { flex: 1 },
  barValue: { height: '100%', backgroundColor: n.accent },
});
