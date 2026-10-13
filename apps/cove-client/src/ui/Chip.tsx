import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, nocturne as n, roundRadius } from '../theme/tokens';
import { Avatar } from './Avatar';

/** A person: their initials in a small avatar, and the name. A tap (when given) adds them to the filter. */
export function PersonChip({
  name,
  onPress,
  accessibilityLabel,
}: {
  name: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      <Avatar name={name} size={22} />
      <Text style={styles.text}>{name}</Text>
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.person, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.person}>{body}</View>
  );
}

/** A tag. A tap (when given) adds it to the filter. */
export function TagChip({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const body = <Text style={styles.text}>{label}</Text>;
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.tag}>{body}</View>
  );
}

/** A saved filter changed since it was loaded. */
export function EditedTag({ small }: { small?: boolean }) {
  return (
    <Text style={[styles.edited, small && styles.editedSmall]}>Edited</Text>
  );
}

const styles = StyleSheet.create({
  person: {
    height: 28,
    paddingLeft: 3,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: roundRadius(28),
    borderWidth: 1,
    borderColor: n.divider,
    backgroundColor: n.surface,
  },
  tag: {
    height: 28,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: n.divider,
    backgroundColor: n.surface,
  },
  pressed: { backgroundColor: n.textAlpha(10) },
  text: { color: n.text, fontSize: 12, fontFamily: fonts.regular },
  edited: {
    paddingHorizontal: 6,
    lineHeight: 17,
    borderRadius: 5,
    overflow: 'hidden',
    fontSize: 11,
    fontFamily: fonts.regular,
    color: n.accent100,
    backgroundColor: n.accent800,
  },
  editedSmall: { fontSize: 10.5, lineHeight: 15 },
});
