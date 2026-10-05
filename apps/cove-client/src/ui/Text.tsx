import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { fonts, nocturne as n, overVideo } from '../theme/tokens';

/** A section's label: small, uppercase, muted. */
export function SectionLabel({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.section, style]}>{children.toUpperCase()}</Text>;
}

/** Nocturne's rule: 1 px, fading out over 48 px at both ends. */
export function Rule({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.rule, style]} />;
}

/** What went wrong, in the one red. */
export function ErrorText({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.error, style]}>{children}</Text>;
}

/** Waiting: the accent, or ink over a picture. */
export function Spinner({
  over,
  size,
}: {
  over?: 'video';
  size?: 'small' | 'large';
}) {
  return (
    <ActivityIndicator
      size={size}
      color={over === 'video' ? overVideo.ink : n.accent}
    />
  );
}

/** A server's or a session's state: lit (with a glow) or not. */
export function StatusDot({ on }: { on: boolean }) {
  return <View style={[styles.dot, on ? styles.dotOn : styles.dotOff]} />;
}

const styles = StyleSheet.create({
  section: {
    color: n.textAlpha(50),
    fontSize: 11.5,
    letterSpacing: 0.9,
    fontFamily: fonts.regular,
  },
  rule: {
    height: 1,
    experimental_backgroundImage: `linear-gradient(to right, transparent 0%, ${n.divider} 14%, ${n.divider} 86%, transparent 100%)`,
  },
  error: {
    color: n.danger,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.regular,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOn: { backgroundColor: n.accent, boxShadow: `0 0 6px ${n.accent}` },
  dotOff: { backgroundColor: n.neutral700 },
});
