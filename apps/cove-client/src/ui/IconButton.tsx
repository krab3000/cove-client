import type { ComponentRef, Ref } from 'react';
import {
  Pressable,
  StyleSheet,
  type Insets,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { nocturne as n } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

export type IconButtonLook = 'plain' | 'round' | 'outlined';

/**
 * An icon you press: plain (no ground), round (a faint disc: close), outlined (a divider ring: the player's back).
 * Sizes 34 / 40 / 44; smaller ones reach 44 with hitSlop.
 */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 'lg',
  look = 'plain',
  iconSize,
  color = n.text,
  fill,
  active,
  hitSlop,
  style,
  ref,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  size?: 'sm' | 'md' | 'lg';
  look?: IconButtonLook;
  iconSize?: number;
  color?: string;
  fill?: boolean;
  // Its menu is open
  active?: boolean;
  hitSlop?: number | Insets;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const box = BOX[size];
  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop ?? Math.max(0, (44 - box) / 2)}
      style={({ pressed }) => [
        styles.button,
        { width: box, height: box },
        look === 'round' && [styles.round, { borderRadius: box / 2 }],
        look === 'outlined' && styles.outlined,
        (pressed || active) &&
          (look === 'round' ? styles.roundPressed : styles.pressed),
        style,
      ]}
    >
      <Icon
        name={icon}
        size={iconSize ?? ICON[size]}
        color={color}
        fill={fill}
      />
    </Pressable>
  );
}

/** ✕: closes a drawer or a panel. */
export function CloseButton({
  onPress,
  accessibilityLabel = 'Close',
}: {
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <IconButton
      icon="x"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      size="sm"
      look="round"
      iconSize={16}
    />
  );
}

/** ‹: back a level or a screen. */
export function BackButton({
  onPress,
  accessibilityLabel = 'Back',
  look = 'plain',
}: {
  onPress: () => void;
  accessibilityLabel?: string;
  look?: 'plain' | 'outlined';
}) {
  return (
    <IconButton
      icon="caret-left"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      size={look === 'outlined' ? 'md' : 'lg'}
      look={look}
      iconSize={20}
    />
  );
}

/** ⋮: a row's menu. */
export function MoreButton({
  onPress,
  accessibilityLabel = 'More',
  active,
  size = 'md',
  ref,
}: {
  onPress: () => void;
  accessibilityLabel?: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  ref?: Ref<ComponentRef<typeof Pressable>>;
}) {
  return (
    <IconButton
      ref={ref}
      icon="dots-three-vertical"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      size={size}
      iconSize={18}
      color={active ? n.text : n.textAlpha(45)}
      active={active}
    />
  );
}

const BOX = { sm: 34, md: 40, lg: 44 };
const ICON = { sm: 16, md: 18, lg: 22 };

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: n.radiusMd,
  },
  round: { backgroundColor: n.textAlpha(8) },
  roundPressed: { backgroundColor: n.textAlpha(14) },
  outlined: { borderWidth: 1, borderColor: n.divider, borderRadius: 10 },
  pressed: { backgroundColor: n.textAlpha(10) },
});
