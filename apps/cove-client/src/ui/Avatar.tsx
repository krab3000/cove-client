import { StyleSheet, Text, View } from 'react-native';
import { initialOf, initials } from '../utils/format';
import { fonts, nocturne as n } from '../theme/tokens';

/**
 * A round avatar with a name's initials: a person's two (small, on a chip) or an account's one. Accent-tinted;
 * its type scales with it.
 */
export function Avatar({
  name,
  size,
  letters,
}: {
  name: string;
  size: number;
  // 'two': a person's initials ("IR"), 'one': an account's ("M"); by default two below 30 px, else one
  letters?: 'one' | 'two';
}) {
  const two = letters ? letters === 'two' : size < 30;
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        size < 30 ? styles.small : styles.large,
      ]}
    >
      <Text style={[styles.text, { fontSize: Math.round(size * 0.42) }]}>
        {two ? initials(name) : initialOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  small: { backgroundColor: n.accent700 },
  large: { backgroundColor: n.accent800 },
  text: { color: n.accent100, fontFamily: fonts.medium },
});
