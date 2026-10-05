import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { fonts, nocturne as n } from '../theme/tokens';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Nocturne's buttons: primary (an accent outline, the action), secondary (a divider outline), text (accent text, for
 * row actions like + Add). Sizes 34 / 44 / 50; an optional leading icon; busy shows a spinner in place of the label.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconFill,
  busy,
  disabled,
  grow,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconFill?: boolean;
  busy?: boolean;
  disabled?: boolean;
  // Takes the rest of its row
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const ink =
    variant === 'primary'
      ? n.accent200
      : variant === 'secondary'
        ? n.text
        : n.accent300;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [
        styles.button,
        styles[size],
        styles[variant],
        grow && styles.grow,
        disabled && styles.disabled,
        pressed && pressedStyle[variant],
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {icon ? (
            <Icon name={icon} fill={iconFill} size={ICON[size]} color={ink} />
          ) : null}
          <Text
            style={[styles.label, label_[size], { color: ink }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const ICON = { sm: 14, md: 16, lg: 16 };

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: n.radiusMd,
  },
  sm: { height: 34, paddingHorizontal: 12 },
  md: { height: 44, paddingHorizontal: 16 },
  lg: { height: 50, paddingHorizontal: 18 },
  primary: { borderWidth: 1, borderColor: n.accent },
  secondary: { borderWidth: 1, borderColor: n.divider },
  text: { paddingHorizontal: 10 },
  grow: { flex: 1 },
  disabled: { opacity: 0.4 },
  label: { fontFamily: fonts.medium },
});

const label_ = StyleSheet.create({
  sm: { fontSize: 13 },
  md: { fontSize: 14 },
  lg: { fontSize: 15 },
});

const pressedStyle = StyleSheet.create({
  primary: { backgroundColor: n.accentAlpha(12) },
  secondary: { backgroundColor: n.textAlpha(7) },
  text: { backgroundColor: n.accentAlpha(10) },
});
