import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export function Button({
  title,
  onPress,
  active,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        active && styles.buttonActive,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

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

export const colors = {
  background: '#0f1115',
  surface: '#191c22',
  surfaceHover: '#232833',
  border: '#2c313c',
  text: '#e8eaee',
  textDim: '#9aa1ad',
  accent: '#4a90e2',
  error: '#ff6b6b',
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
  },
  buttonActive: { backgroundColor: '#2b5797' },
  buttonPressed: { opacity: 0.7 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.text },
  bar: {
    height: 12,
    backgroundColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: { flex: 1 },
  barValue: { height: '100%', backgroundColor: colors.accent },
});
