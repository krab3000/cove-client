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
  'funnel-simple': 0xe268,
  'magic-wand': 0xe6b6,
  'arrow-square-in': 0xe5dc,
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
  'scissors': 0xeae0,
  'copy': 0xe1ca,
  'clipboard-text': 0xe198,
  'arrow-line-up': 0xe066,
  'arrow-line-down': 0xe05c,
  'arrow-elbow-up-left': 0xe054,
  'eraser': 0xe21e,
  // Library (1f, 1g)
  'sort-descending': 0xe446,
  'shuffle': 0xe422,
  'squares-four': 0xe464,
  'dots-nine': 0xe1fc,
  'rows': 0xe5a2,
  'heart': 0xe2a8,
  'bookmark-simple': 0xe0ea,
  'bookmarks-simple': 0xe5f0,
  'star': 0xe46a,
  'stack': 0xe466,
  'eye-slash': 0xe224,
  'play-circle': 0xe3d2,
  'user': 0xe4c2,
  'sign-out': 0xe42a,
  'arrow-clockwise': 0xe036,
  'film-strip': 0xe792,
  // Player (1k, 1l)
  'clock-counter-clockwise': 0xe1a0,
  'clock-clockwise': 0xe19e,
  'corners-out': 0xe1d0,
  'corners-in': 0xe1ce,
  'gear-six': 0xe272,
  'lock-simple-open': 0xe30a,
  'list-bullets': 0xe2f2,
  'skip-forward': 0xe5a6,
  'arrow-counter-clockwise': 0xe038,
  'gauge': 0xe628,
  'pause': 0xe39e,
  'speaker-high': 0xe44a,
  'speaker-slash': 0xe45a,
  'waveform': 0xe802,
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
