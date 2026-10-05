import { Pressable, StyleSheet, Text } from 'react-native';
import { fonts, nocturne as n, overVideo } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

/**
 * Save for later or Favorite, as an icon you press: a divider ring, the accent ring and a filled icon when on.
 * round (40) on list cards, square (44) beside a button.
 */
export function MarkToggle({
  kind,
  on,
  onPress,
  shape = 'round',
}: {
  kind: 'later' | 'favorite';
  on: boolean;
  onPress: () => void;
  shape?: 'round' | 'square';
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={kind === 'later' ? 'Save for later' : 'Favorite'}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.mark,
        shape === 'round' ? styles.round : styles.square,
        on && styles.markOn,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        name={kind === 'later' ? 'bookmark-simple' : 'heart'}
        fill={on}
        size={shape === 'round' ? 20 : 19}
        color={on ? n.accent : n.text}
      />
    </Pressable>
  );
}

/**
 * A labelled pill: an action or a toggle with its word (Save for later, Favorite, Start over, Audio). On the ground,
 * or over the video (smaller, ink).
 */
export function Pill({
  icon,
  label,
  onPress,
  on,
  fill,
  over,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  on?: boolean;
  fill?: boolean;
  // Over the video, not on the ground
  over?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={on !== undefined ? { selected: on } : undefined}
      style={({ pressed }) => [
        styles.pill,
        over ? styles.pillOver : styles.pillGround,
        on && styles.markOn,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        name={icon}
        fill={fill}
        size={over ? 14 : 15}
        color={on ? n.accent : over ? overVideo.ink : n.text}
      />
      <Text
        style={[
          styles.pillText,
          over ? styles.pillTextOver : styles.pillTextGround,
          on && styles.pillTextOn,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: n.divider,
  },
  round: { width: 40, height: 40, borderRadius: 20 },
  square: { width: 44, height: 44, borderRadius: n.radiusMd },
  markOn: { borderColor: n.accent },
  pressed: { backgroundColor: n.textAlpha(6) },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: n.radiusPill,
    borderWidth: 1,
  },
  pillGround: { height: 38, paddingHorizontal: 14, borderColor: n.divider },
  pillOver: {
    height: 32,
    paddingHorizontal: 12,
    borderColor: overVideo.inkAlpha(30),
  },
  pillText: { fontFamily: fonts.regular },
  pillTextGround: { color: n.text, fontSize: 13 },
  pillTextOver: { color: overVideo.ink, fontSize: 12 },
  pillTextOn: { color: n.accent },
});
