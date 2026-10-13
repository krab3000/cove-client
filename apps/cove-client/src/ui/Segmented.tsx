import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, nocturne as n } from '../theme/tokens';

/**
 * A segmented control (Nocturne): equal options in a divider frame; the chosen one gets an inset accent ring and
 * accent text.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  return (
    <View
      style={styles.frame}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [
              styles.option,
              on && styles.optionOn,
              pressed && !on && styles.pressed,
            ]}
          >
            <Text
              style={[styles.label, on && styles.labelOn]}
              numberOfLines={1}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: n.divider,
    borderRadius: n.radiusMd,
    overflow: 'hidden',
  },
  option: {
    flex: 1,
    minWidth: 0,
    height: 40,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: n.radiusMd - 1,
  },
  optionOn: { borderWidth: 1, borderColor: n.accent },
  pressed: { backgroundColor: n.textAlpha(6) },
  label: { color: n.text, fontSize: 12.5, fontFamily: fonts.regular },
  labelOn: { color: n.accent },
});
