import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, nocturne as n } from '../theme/tokens';
import { CloseButton } from './IconButton';

/**
 * A drawer's or a panel's header: its title (a heading, or a small uppercase label), what it is about, and ✕.
 * Something can go before the title (a back button).
 */
export function PanelHeader({
  title,
  detail,
  caps,
  left,
  onClose,
  closeLabel,
}: {
  title: string;
  detail?: string;
  // The title as a small uppercase label ("PREVIEW")
  caps?: boolean;
  left?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <View style={styles.header}>
      {left}
      <Text style={caps ? styles.caps : styles.title} numberOfLines={1}>
        {caps ? title.toUpperCase() : title}
      </Text>
      {detail ? (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      <View style={styles.spacer} />
      <CloseButton onPress={onClose} accessibilityLabel={closeLabel} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 48,
    paddingTop: 14,
    paddingLeft: 20,
    paddingRight: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { color: n.text, fontSize: 17, fontFamily: fonts.medium },
  caps: {
    color: n.textAlpha(50),
    fontSize: 12,
    letterSpacing: 1,
    fontFamily: fonts.regular,
  },
  detail: {
    flexShrink: 1,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
  spacer: { flex: 1 },
});
