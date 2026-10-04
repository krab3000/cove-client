import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

// Phosphor icons (https://phosphoricons.com), from its icon fonts in android/app/src/main/assets/fonts: the glyphs the
// app uses, by name, with their codepoints from @phosphor-icons/web's style.css.
const GLYPHS = {
  'caret-left': 0xe138,
  'caret-right': 0xe13a,
  'caret-up-down': 0xe140,
  'caret-down': 0xe136,
  'dots-three-vertical': 0xe208,
  'plus': 0xe3d4,
  'brackets-curly': 0xe860,
  'play': 0xe3d0,
  'x': 0xe4f6,
  'magnifying-glass': 0xe30c,
  'check': 0xe182,
  'minus': 0xe32a,
  'trash': 0xe4a6,
  'pencil-simple': 0xe3b4,
  'folder': 0xe24a,
  'hard-drives': 0xe2a0,
  'tree-structure': 0xe67c,
  'cursor-text': 0xe7d8,
  'lock-simple': 0xe308,
  'check-circle': 0xe184,
  'warning-circle': 0xe4e2,
  'x-circle': 0xe4f8,
  'arrow-elbow-down-right': 0xe046,
} as const;

export type IconName = keyof typeof GLYPHS;

/** A Phosphor icon: regular, or fill (active states, play). */
export function Icon({
  name,
  size = 16,
  color,
  fill,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  fill?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        styles.icon,
        fill ? styles.fill : styles.regular,
        {
          fontSize: size,
          lineHeight: size,
          color,
        },
        style,
      ]}
      allowFontScaling={false}
    >
      {String.fromCharCode(GLYPHS[name])}
    </Text>
  );
}

const styles = StyleSheet.create({
  icon: { includeFontPadding: false, textAlignVertical: 'center' },
  regular: { fontFamily: 'Phosphor' },
  fill: { fontFamily: 'Phosphor-Fill' },
});
