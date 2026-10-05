import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SavedFilter } from '../api/types';
import { fonts, nocturne as n } from '../theme/tokens';
import { Icon, type IconName } from '../ui/Icon';
import { Avatar } from '../ui/Avatar';

/** What the Library shows, as the sidebar marks it. */
export type SidebarActive =
  | { kind: 'all' }
  | { kind: 'quick'; key: string }
  | { kind: 'saved'; id: number }
  | { kind: 'other' };

export interface SidebarQuick {
  key: string;
  label: string;
  icon: IconName;
}

/**
 * The tablet's sidebar (design 1h): the Show sheet's job, always open — the Library (all videos, with the count), the
 * quick filters (Watch), the saved filters with their counts, Save as new filter — and the account as its bottom row.
 * Folded (rail, design 2d) while the filter column needs the width: the brand, Library and the account.
 */
export function LibrarySidebar({
  rail,
  server,
  username,
  allCount,
  active,
  quick,
  saved,
  savedCounts,
  canSaveNew,
  onAll,
  onQuick,
  onSaved,
  onSaveNew,
  onAccount,
}: {
  rail: boolean;
  server: string;
  username: string;
  allCount: number | null;
  active: SidebarActive;
  quick: SidebarQuick[];
  saved: SavedFilter[];
  savedCounts: Record<number, number>;
  canSaveNew: boolean;
  onAll: () => void;
  onQuick: (key: string) => void;
  onSaved: (filter: SavedFilter) => void;
  onSaveNew: () => void;
  onAccount: () => void;
}) {
  if (rail)
    return (
      <View style={styles.rail}>
        <View style={[styles.brandMark, styles.railBrand]} />
        <Pressable
          onPress={onAll}
          accessibilityLabel="Library"
          style={[styles.railItem, styles.railItemOn]}
        >
          <Icon name="squares-four" fill size={22} color={n.accent} />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable onPress={onAccount} accessibilityLabel="Account">
          <Avatar name={username} size={32} letters="one" />
        </Pressable>
      </View>
    );
  const count = (c: number | undefined | null) =>
    c == null ? '' : c.toLocaleString('en-US');
  return (
    <View style={styles.sidebar}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.brand}>
          <View style={styles.brandMark} />
          <Text style={styles.brandText}>Cove</Text>
        </View>
        <View style={styles.server}>
          <View style={styles.serverDot} />
          <Text style={styles.serverText} numberOfLines={1}>
            {server.replace(/^https?:\/\//, '')}
          </Text>
        </View>
        <Row
          icon="squares-four"
          label="Library"
          meta={count(allCount)}
          on={active.kind === 'all'}
          big
          onPress={onAll}
        />
        <Text style={styles.section}>WATCH</Text>
        {quick.map((q) => (
          <Row
            key={q.key}
            icon={q.icon}
            label={q.label}
            on={active.kind === 'quick' && active.key === q.key}
            onPress={() => onQuick(q.key)}
          />
        ))}
        {saved.length ? (
          <Text style={styles.section}>SAVED FILTERS</Text>
        ) : null}
        {saved.map((f) => (
          <Row
            key={f.id}
            icon="bookmarks-simple"
            label={f.name}
            meta={count(savedCounts[f.id])}
            on={active.kind === 'saved' && active.id === f.id}
            onPress={() => onSaved(f)}
          />
        ))}
        {canSaveNew ? (
          <Pressable
            onPress={onSaveNew}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Icon name="plus" size={18} color={n.accent200} />
            <Text style={[styles.rowLabel, styles.saveNew]}>
              Save as new filter…
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      <Pressable
        onPress={onAccount}
        accessibilityLabel="Account"
        style={({ pressed }) => [styles.account, pressed && styles.pressed]}
      >
        <Avatar name={username} size={32} letters="one" />
        <Text style={styles.accountName} numberOfLines={1}>
          {username}
        </Text>
        <Icon name="caret-up-down" size={16} color={n.textAlpha(55)} />
      </Pressable>
    </View>
  );
}

function Row({
  icon,
  label,
  meta,
  on,
  big,
  onPress,
}: {
  icon: IconName;
  label: string;
  meta?: string;
  on: boolean;
  big?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [
        styles.row,
        big && styles.rowBig,
        on && styles.rowOn,
        pressed && !on && styles.pressed,
      ]}
    >
      <Icon
        name={icon}
        fill={on}
        size={big ? 20 : 18}
        color={on ? n.accent : n.textAlpha(78)}
      />
      <Text
        style={[
          styles.rowLabel,
          big && styles.rowLabelBig,
          on && styles.rowLabelOn,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
    </Pressable>
  );
}

const SIDE_BG = '#1d1f2c'; // surface 55% over the ground

const styles = StyleSheet.create({
  sidebar: { width: 232, backgroundColor: SIDE_BG },
  scroll: { paddingTop: 20, paddingHorizontal: 12, paddingBottom: 12, gap: 2 },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 14,
  },
  brandMark: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: n.accent,
  },
  brandText: { color: n.text, fontSize: 17, fontFamily: fonts.medium },
  server: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 4,
    marginBottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
  },
  serverDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: n.accent,
  },
  serverText: {
    flex: 1,
    color: n.text,
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
  section: {
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 6,
    color: n.textAlpha(45),
    fontSize: 10.5,
    letterSpacing: 1,
    fontFamily: fonts.regular,
  },
  row: {
    height: 38,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: n.radiusMd,
  },
  rowBig: { height: 42 },
  rowOn: { backgroundColor: n.accentAlpha(13) },
  pressed: { backgroundColor: n.textAlpha(6) },
  rowLabel: {
    flex: 1,
    color: n.textAlpha(78),
    fontSize: 13.5,
    fontFamily: fonts.regular,
  },
  rowLabelBig: { fontSize: 14 },
  rowLabelOn: { color: n.accent },
  rowMeta: {
    color: n.textAlpha(45),
    fontSize: 11.5,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  saveNew: { color: n.accent200 },
  spacer: { flex: 1 },
  account: {
    margin: 12,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: n.radiusMd,
  },
  accountName: {
    flex: 1,
    color: n.text,
    fontSize: 13.5,
    fontFamily: fonts.regular,
  },
  rail: {
    width: 76,
    paddingTop: 20,
    paddingBottom: 16,
    alignItems: 'center',
    gap: 6,
    backgroundColor: SIDE_BG,
  },
  railBrand: { marginBottom: 22 },
  railItem: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railItemOn: {
    backgroundColor: n.accentAlpha(14),
    borderWidth: 1,
    borderColor: n.accentAlpha(50),
  },
});
