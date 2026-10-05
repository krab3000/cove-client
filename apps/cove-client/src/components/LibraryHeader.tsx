import { useRef, useState, type ComponentRef } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { fonts, nocturne as n } from '../filter/theme';
import { Icon, type IconName } from './Icon';

export type LibraryView = 'grid2' | 'grid3' | 'list';

/** A condition of the filter as a chip in the filter bar. */
export interface FilterChip {
  id: string;
  label: string;
  // An include, an exclude (struck through), a subgroup (a token), or what the app can't show
  kind: 'in' | 'ex' | 'group' | 'more';
}

/** A one-tap filter offered while there is none: a saved filter, or a built-in shortcut. */
export interface FilterPreset {
  key: string;
  label: string;
  icon: IconName;
  saved: boolean;
  onPress: () => void;
}

const VIEWS: { view: LibraryView; icon: IconName; label: string }[] = [
  { view: 'grid2', icon: 'squares-four', label: '2 columns' },
  { view: 'grid3', icon: 'dots-nine', label: '3 columns' },
  { view: 'list', icon: 'rows', label: 'List' },
];

/**
 * The Library's header (design 1f/1g), the same over all three views: "Videos" or the saved filter's name (with
 * Edited and Save once it is changed), the count line, the filter bar (Filter with its count, the filter's
 * conditions as chips, Clear; the saved filters while there is no filter) and the sort row with the view switch.
 */
export function LibraryHeader({
  title,
  saved,
  edited,
  onSave,
  countLine,
  chips,
  presets,
  onOpenFilter,
  onOpenChip,
  onRemoveChip,
  onClear,
  shuffled,
  onShuffle,
  onPlayAll,
  view,
  onView,
  username,
  onRefresh,
  onLogout,
}: {
  title: string;
  saved: boolean;
  edited: boolean;
  // Absent when this filter can't be saved from here
  onSave?: () => void;
  countLine: string;
  chips: FilterChip[];
  presets: FilterPreset[];
  onOpenFilter: () => void;
  onOpenChip: (id: string) => void;
  onRemoveChip: (id: string) => void;
  onClear: () => void;
  shuffled: boolean;
  onShuffle: () => void;
  onPlayAll: () => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  username: string;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  // The ⋮ menu, under its button: in a Modal, so it draws over the list (and nothing in the header has to sit
  // above its siblings, which on Android would put it above the player too).
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const menuButton = useRef<ComponentRef<typeof View>>(null);
  const window = useWindowDimensions();
  const openMenu = () =>
    menuButton.current?.measureInWindow((x, y, w, h) =>
      setMenu({ top: y + h, right: Math.max(8, window.width - x - w) })
    );
  const active = chips.length > 0;
  const badge = chips.filter((c) => c.kind !== 'more').length;
  return (
    <View>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          {saved ? (
            <View style={styles.kicker}>
              <Icon name="bookmarks-simple" size={13} color={n.accent300} />
              <Text style={styles.kickerText}>SAVED FILTER</Text>
              {edited ? <Text style={styles.edited}>Edited</Text> : null}
              {edited && onSave ? (
                <Pressable onPress={onSave} hitSlop={8}>
                  <Text style={styles.save}>Save</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Pressable
          ref={menuButton}
          onPress={openMenu}
          accessibilityLabel="More"
          style={styles.iconButton}
        >
          <Icon name="dots-three-vertical" size={22} color={n.text} />
        </Pressable>
      </View>
      <Text style={styles.count}>{countLine}</Text>

      <View style={styles.bar}>
        <Pressable
          onPress={onOpenFilter}
          accessibilityRole="button"
          accessibilityLabel={active ? `Filter, ${badge} conditions` : 'Filter'}
          style={[styles.filterButton, active && styles.filterButtonActive]}
        >
          <Icon
            name="funnel-simple"
            size={17}
            color={active ? n.accent200 : n.text}
          />
          <Text style={[styles.filterText, active && styles.filterTextActive]}>
            Filter
          </Text>
          {active ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
        >
          {chips.map((c) => (
            <Chip
              key={c.id}
              chip={c}
              onOpen={() => onOpenChip(c.id)}
              onRemove={() => onRemoveChip(c.id)}
            />
          ))}
          {active ? (
            <Pressable onPress={onClear} hitSlop={6} style={styles.clear}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : (
            presets.map((p) => (
              <Pressable
                key={p.key}
                onPress={p.onPress}
                style={({ pressed }) => [
                  styles.preset,
                  p.saved ? styles.presetSaved : styles.presetPill,
                  pressed && styles.pressed,
                ]}
              >
                <Icon name={p.icon} size={14} color={n.accent300} />
                <Text style={styles.presetText}>{p.label}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>

      <View style={styles.sortRow}>
        {/* Cove's seeded random sort; off = newest first */}
        <View style={styles.sort}>
          <Icon name="sort-descending" size={16} color={n.textAlpha(75)} />
          <Text style={styles.sortText}>{shuffled ? 'Random' : 'Added'}</Text>
        </View>
        <Pressable
          onPress={onShuffle}
          accessibilityLabel="Shuffle"
          accessibilityState={{ selected: shuffled }}
          style={[styles.iconButton40, shuffled && styles.shuffleOn]}
        >
          <Icon
            name="shuffle"
            size={17}
            color={shuffled ? n.accent : n.textAlpha(75)}
          />
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          onPress={onPlayAll}
          style={({ pressed }) => [
            styles.playAll,
            pressed && styles.playAllPressed,
          ]}
        >
          <Icon name="play" fill size={12} color={n.accent200} />
          <Text style={styles.playAllText}>Play all</Text>
        </Pressable>
        <View style={styles.views}>
          {VIEWS.map((v) => (
            <Pressable
              key={v.view}
              onPress={() => onView(v.view)}
              accessibilityLabel={v.label}
              accessibilityState={{ selected: view === v.view }}
              style={[styles.viewButton, view === v.view && styles.viewOn]}
            >
              <Icon
                name={v.icon}
                size={16}
                color={view === v.view ? n.accent : n.textAlpha(60)}
              />
            </Pressable>
          ))}
        </View>
      </View>

      <Modal
        visible={!!menu}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setMenu(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenu(null)} />
        <View style={[styles.menu, menu]}>
          <Text style={styles.menuUser} numberOfLines={1}>
            {username}
          </Text>
          <MenuItem
            label="Refresh"
            onPress={() => {
              setMenu(null);
              onRefresh();
            }}
          />
          <MenuItem
            label="Log out"
            icon="sign-out"
            onPress={() => {
              setMenu(null);
              onLogout();
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

function Chip({
  chip,
  onOpen,
  onRemove,
}: {
  chip: FilterChip;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const look = CHIP_LOOK[chip.kind];
  return (
    <Pressable
      onPress={onOpen}
      style={[styles.chip, { backgroundColor: look.bg }]}
    >
      {chip.kind === 'ex' ? (
        <Icon name="minus" size={13} color={look.ink} />
      ) : chip.kind === 'group' ? (
        <Icon name="brackets-curly" size={13} color={look.ink} />
      ) : null}
      <Text
        style={[
          styles.chipText,
          { color: look.ink },
          chip.kind === 'ex' && styles.struck,
        ]}
      >
        {chip.label}
      </Text>
      {chip.kind === 'group' ? (
        <Icon name="caret-right" size={10} color={look.ink} />
      ) : null}
      {chip.kind === 'more' ? (
        <View style={styles.chipEnd} />
      ) : (
        <Pressable
          onPress={onRemove}
          accessibilityLabel={`Remove ${chip.label}`}
          hitSlop={6}
          style={styles.chipX}
        >
          <Icon name="x" size={12} color={look.ink} />
        </Pressable>
      )}
    </Pressable>
  );
}

const CHIP_LOOK: Record<FilterChip['kind'], { bg: string; ink: string }> = {
  in: { bg: n.accent800, ink: n.accent100 },
  ex: { bg: n.neutral800, ink: n.neutral300 },
  group: { bg: n.accentAlpha(14), ink: n.accent200 },
  more: { bg: 'transparent', ink: n.textAlpha(60) },
};

function MenuItem({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && styles.menuPressed]}
    >
      {icon ? <Icon name={icon} size={18} color={n.accent300} /> : null}
      <Text style={styles.menuText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    paddingTop: 6,
    paddingLeft: 20,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { height: 24, flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerText: {
    color: n.textAlpha(50),
    fontSize: 11,
    letterSpacing: 0.9,
    fontFamily: fonts.regular,
  },
  edited: {
    marginLeft: 2,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: n.accent800,
    color: n.accent100,
    fontFamily: fonts.regular,
  },
  save: {
    paddingHorizontal: 6,
    fontSize: 13,
    color: n.accent300,
    fontFamily: fonts.medium,
  },
  title: { color: n.text, fontSize: 28, fontFamily: fonts.medium },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    paddingHorizontal: 20,
    paddingTop: 2,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  bar: {
    marginTop: 8,
    paddingVertical: 8,
    paddingLeft: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterButton: {
    height: 36,
    paddingLeft: 11,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: n.divider,
  },
  filterButtonActive: {
    borderColor: n.accent,
    backgroundColor: n.accentAlpha(12),
  },
  filterText: { color: n.text, fontSize: 13.5, fontFamily: fonts.medium },
  filterTextActive: { color: n.accent200 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accent800,
  },
  badgeText: {
    color: n.accent100,
    fontSize: 11.5,
    fontFamily: fonts.semiBold,
    fontVariant: ['tabular-nums'],
  },
  chipScroll: { flex: 1 },
  chips: { gap: 6, alignItems: 'center', paddingRight: 16 },
  chip: {
    height: 32,
    paddingLeft: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 16,
  },
  chipText: { fontSize: 12.5, fontFamily: fonts.regular },
  struck: { textDecorationLine: 'line-through' },
  chipX: {
    width: 28,
    height: 28,
    marginRight: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipEnd: { width: 9 },
  clear: { height: 32, paddingHorizontal: 6, justifyContent: 'center' },
  clearText: { color: n.accent300, fontSize: 13, fontFamily: fonts.regular },
  preset: {
    height: 32,
    paddingLeft: 10,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: n.divider,
  },
  presetSaved: { borderRadius: n.radiusMd },
  presetPill: { borderRadius: 16 },
  presetText: { color: n.text, fontSize: 12.5, fontFamily: fonts.regular },
  pressed: { opacity: 0.7 },
  sortRow: {
    paddingTop: 2,
    paddingLeft: 12,
    paddingRight: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  sort: {
    height: 40,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortText: { color: n.textAlpha(75), fontSize: 13, fontFamily: fonts.regular },
  iconButton40: {
    width: 40,
    height: 40,
    borderRadius: n.radiusMd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleOn: { backgroundColor: n.accentAlpha(12) },
  spacer: { flex: 1 },
  playAll: {
    height: 34,
    marginRight: 8,
    paddingLeft: 10,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
  },
  playAllPressed: { backgroundColor: n.accentAlpha(12) },
  playAllText: { color: n.accent200, fontSize: 13, fontFamily: fonts.medium },
  views: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: n.divider,
    borderRadius: n.radiusMd,
    overflow: 'hidden',
  },
  viewButton: {
    width: 38,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  viewOn: { borderColor: n.accent },
  backdrop: { ...StyleSheet.absoluteFillObject },
  menu: {
    position: 'absolute',
    minWidth: 200,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: n.surface,
    borderWidth: 1,
    borderColor: n.divider,
    elevation: 8,
  },
  menuUser: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
  menuItem: {
    height: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuPressed: { backgroundColor: n.textAlpha(7) },
  menuText: { color: n.text, fontSize: 15, fontFamily: fonts.regular },
});
