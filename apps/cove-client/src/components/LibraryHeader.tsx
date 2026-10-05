import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fonts, nocturne as n } from '../filter/theme';
import { Icon, type IconName } from './Icon';

export type LibraryView = 'grid2' | 'grid3' | 'list';

/** A condition of the filter as a chip (wide screens only). */
export interface FilterChip {
  id: string;
  label: string;
  // An include, an exclude (struck through), a subgroup (a token), or what the app can't show
  kind: 'in' | 'ex' | 'group' | 'more';
}

const VIEWS: { view: LibraryView; icon: IconName; label: string }[] = [
  { view: 'grid2', icon: 'squares-four', label: '2 columns' },
  { view: 'grid3', icon: 'dots-nine', label: '3 columns' },
  { view: 'list', icon: 'rows', label: 'List' },
];

/**
 * The Library's header (design turn 6), the same over all three views. Each control has one place: the search field
 * (Cove's search) and the avatar (the account) on top; the title, which says what is shown and opens the Show sheet,
 * with the count line under it and Save / Save as… when there is something to save; then the toolbar: Filter with its
 * count, the sort, Shuffle, Play all and the view switch. A phone lists no conditions (the editor does); a wide
 * screen shows them as chips on the toolbar.
 */
export function LibraryHeader({
  query,
  onQuery,
  onSubmitQuery,
  avatar,
  onOpenAccount,
  title,
  savedFilter,
  countLine,
  edited,
  saveLabel,
  onSave,
  onOpenShow,
  filterCount,
  onOpenFilter,
  shuffled,
  onShuffle,
  onPlayAll,
  view,
  onView,
  chips,
  onOpenChip,
  onRemoveChip,
}: {
  query: string;
  onQuery: (q: string) => void;
  onSubmitQuery: () => void;
  avatar: string;
  onOpenAccount: () => void;
  title: string;
  // The title is a saved filter's name
  savedFilter: boolean;
  countLine: string;
  edited: boolean;
  // "Save" or "Save as…", or null when there is nothing to save
  saveLabel: string | null;
  onSave: () => void;
  onOpenShow: () => void;
  filterCount: number;
  onOpenFilter: () => void;
  shuffled: boolean;
  onShuffle: () => void;
  onPlayAll: () => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  // Wide screens only
  chips: FilterChip[] | null;
  onOpenChip: (id: string) => void;
  onRemoveChip: (id: string) => void;
}) {
  const active = filterCount > 0;
  return (
    <View>
      <View style={styles.searchRow}>
        <View style={[styles.search, query ? styles.searchActive : null]}>
          <Icon name="magnifying-glass" size={18} color={n.textAlpha(55)} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            onSubmitEditing={onSubmitQuery}
            placeholder="Search videos, tags, performers…"
            placeholderTextColor={n.textAlpha(45)}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search"
            style={styles.searchInput}
          />
          {query ? (
            <Pressable
              onPress={() => onQuery('')}
              accessibilityLabel="Clear search"
              hitSlop={4}
              style={styles.searchClear}
            >
              <Icon name="x" size={15} color={n.textAlpha(60)} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onOpenAccount}
          accessibilityLabel="Account"
          style={styles.avatarButton}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatar}</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.titleRow}>
        <Pressable
          onPress={onOpenShow}
          accessibilityRole="button"
          accessibilityLabel={`Show: ${title}`}
          style={({ pressed }) => [
            styles.titleButton,
            pressed && styles.pressedBg,
          ]}
        >
          <View style={styles.titleLine}>
            {savedFilter ? (
              <Icon
                name="bookmarks-simple"
                fill
                size={17}
                color={n.accent300}
              />
            ) : null}
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Icon name="caret-down" size={14} color={n.textAlpha(55)} />
          </View>
          <View style={styles.countLine}>
            {edited ? <Text style={styles.edited}>Edited</Text> : null}
            <Text style={styles.count} numberOfLines={1}>
              {countLine}
            </Text>
          </View>
        </Pressable>
        {saveLabel ? (
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.save, pressed && styles.accentBg]}
          >
            <Text style={styles.saveText}>{saveLabel}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.toolbar}>
        <Pressable
          onPress={onOpenFilter}
          accessibilityRole="button"
          accessibilityLabel={
            active ? `Filter, ${filterCount} conditions` : 'Filter'
          }
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
              <Text style={styles.badgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
        {/* Newest added first, or Cove's seeded random sort while shuffled */}
        <View style={styles.sort}>
          <Icon name="sort-descending" size={16} color={n.textAlpha(75)} />
          <Text style={styles.sortText}>{shuffled ? 'Random' : 'Added'}</Text>
        </View>
        <Pressable
          onPress={onShuffle}
          accessibilityLabel="Shuffle"
          accessibilityState={{ selected: shuffled }}
          style={[styles.icon36, shuffled && styles.shuffleOn]}
        >
          <Icon
            name="shuffle"
            size={17}
            color={shuffled ? n.accent : n.textAlpha(75)}
          />
        </Pressable>
        {chips ? (
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
          </ScrollView>
        ) : (
          <View style={styles.spacer} />
        )}
        <Pressable
          onPress={onPlayAll}
          accessibilityLabel="Play all"
          style={({ pressed }) => [styles.play, pressed && styles.accentBg]}
        >
          <Icon name="play" fill size={14} color={n.accent200} />
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

const styles = StyleSheet.create({
  searchRow: {
    paddingTop: 6,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  search: {
    flex: 1,
    minWidth: 0,
    height: 44,
    paddingLeft: 14,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: n.surface,
  },
  searchActive: { borderColor: n.accent },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: n.text,
    fontSize: 15,
    fontFamily: fonts.regular,
  },
  searchClear: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accent800,
  },
  avatarText: { color: n.accent100, fontSize: 15, fontFamily: fonts.medium },
  titleRow: {
    minHeight: 52,
    paddingTop: 8,
    paddingLeft: 8,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleButton: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: n.radiusMd,
    gap: 1,
  },
  pressedBg: { backgroundColor: n.textAlpha(6) },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    flexShrink: 1,
    color: n.text,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontFamily: fonts.medium,
  },
  countLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  edited: {
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 6,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: n.accent800,
    color: n.accent100,
    fontFamily: fonts.regular,
  },
  count: {
    flexShrink: 1,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  save: {
    height: 34,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
  },
  accentBg: { backgroundColor: n.accentAlpha(12) },
  saveText: { color: n.accent200, fontSize: 13, fontFamily: fonts.medium },
  toolbar: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  sort: {
    height: 36,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sortText: { color: n.textAlpha(75), fontSize: 13, fontFamily: fonts.regular },
  icon36: {
    width: 36,
    height: 36,
    borderRadius: n.radiusMd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleOn: { backgroundColor: n.accentAlpha(12) },
  spacer: { flex: 1 },
  chipScroll: { flex: 1, marginHorizontal: 4 },
  chips: { gap: 6, alignItems: 'center' },
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
  play: {
    width: 36,
    height: 36,
    marginRight: 4,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: n.accent,
  },
  views: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: n.divider,
    borderRadius: n.radiusMd,
    overflow: 'hidden',
  },
  viewButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  viewOn: { borderColor: n.accent },
});
