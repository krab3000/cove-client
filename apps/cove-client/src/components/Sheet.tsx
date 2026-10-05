import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fonts, nocturne as n } from '../filter/theme';
import { Icon, type IconName } from './Icon';

/**
 * A bottom sheet (Nocturne): surface, 22 px top corners, grabber, over a dimmed screen. A tap on the dim, or Android
 * back, closes it. In a Modal, so it draws over everything (the player included).
 */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityLabel="Close"
        />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A 52 px sheet row: an accent icon, a label, an optional detail line, an optional check. */
export function SheetRow({
  icon,
  label,
  meta,
  checked,
  accent,
  onPress,
}: {
  icon: IconName;
  label: string;
  meta?: string;
  checked?: boolean;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: !!checked }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Icon name={icon} size={20} color={n.accent300} />
      <View style={styles.rowText}>
        <Text
          style={[styles.rowLabel, accent && styles.rowLabelAccent]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {checked ? <Icon name="check" size={18} color={n.accent} /> : null}
    </Pressable>
  );
}

export function SheetHeading({ children }: { children: string }) {
  return <Text style={styles.heading}>{children}</Text>;
}

/** A section label: small, uppercase, muted. */
export function SheetSection({ children }: { children: string }) {
  return <Text style={styles.section}>{children.toUpperCase()}</Text>;
}

/** Nocturne's rule: 1 px, fading out over 48 px at both ends (approximated: inset, at divider strength). */
export function SheetRule() {
  return <View style={styles.rule} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: n.scrim },
  sheet: {
    paddingTop: 8,
    paddingBottom: Platform.OS === 'android' ? 56 : 30,
    borderTopLeftRadius: n.radiusSheet,
    borderTopRightRadius: n.radiusSheet,
    backgroundColor: n.surface,
    maxHeight: '85%',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 6,
    backgroundColor: n.neutral700,
  },
  heading: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
    color: n.text,
    fontSize: 17,
    fontFamily: fonts.medium,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 4,
    color: n.textAlpha(50),
    fontSize: 11.5,
    letterSpacing: 0.9,
    fontFamily: fonts.regular,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  rowPressed: { backgroundColor: n.textAlpha(6) },
  rowText: { flex: 1, minWidth: 0, gap: 1 },
  rowLabel: { color: n.text, fontSize: 15, fontFamily: fonts.regular },
  rowLabelAccent: { color: n.accent200 },
  rowMeta: { color: n.textAlpha(55), fontSize: 12, fontFamily: fonts.regular },
  rule: {
    height: 1,
    marginVertical: 8,
    marginHorizontal: 24,
    backgroundColor: n.divider,
  },
});
