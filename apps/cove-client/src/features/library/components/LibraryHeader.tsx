import { memo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fonts, nocturne as n } from '../../../theme/tokens';
import { Icon, type IconName } from '../../../ui/Icon';
import { Avatar } from '../../../ui/Avatar';
import { EditedTag } from '../../../ui/Chip';
import { Popover } from '../../../ui/Menu';

export type LibraryView = 'grid2' | 'grid3' | 'list';

const VIEWS: { view: LibraryView; icon: IconName; label: string }[] = [
  { view: 'grid2', icon: 'squares-four', label: 'Grid' },
  { view: 'grid3', icon: 'dots-nine', label: 'Dense grid' },
  { view: 'list', icon: 'rows', label: 'Feed' },
];

/**
 * The view switch as one button (a phone, where three of them did not fit the toolbar): the view in effect, opening a
 * menu of the three under it.
 */
function ViewMenu({
  view,
  onView,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
}) {
  const button = useRef<ComponentRef<typeof View>>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const current = VIEWS.find((v) => v.view === view) ?? VIEWS[0]!;
  return (
    <>
      <Pressable
        ref={button}
        onPress={() =>
          button.current?.measureInWindow((x, y, w, h) =>
            setAnchor({ x: x + w, y: y + h })
          )
        }
        accessibilityRole="button"
        accessibilityLabel={`View: ${current.label}`}
        style={({ pressed }) => [styles.viewMenu, pressed && styles.pressedBg]}
      >
        <Icon name={current.icon} size={16} color={n.accent} />
        <Icon name="caret-down" size={12} color={n.textAlpha(55)} />
      </Pressable>
      <Popover
        visible={anchor != null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        items={VIEWS.map((v) => ({
          icon: v.icon,
          label: v.label,
          selected: v.view === view,
          onPress: () => onView(v.view),
        }))}
      />
    </>
  );
}

/**
 * The Library's header (design turn 6), the same over all three views. Each control has one place: the search field
 * (Cove's search) and the avatar (the account) on top; the title, which says what is shown and opens the Show sheet,
 * with the count line under it (on a large screen it shares its row with the search); then the toolbar: Filter with its
 * count, the sort, Shuffle, Play all and the view switch (on a phone one button with a menu, see ViewMenu). No screen lists the filter's conditions (only the editor
 * does). A phone held sideways (compact, design 6f–6h) gets all of it in one row; on a large screen (large, 1h) the
 * sidebar holds the account and the saved filters, so there is no avatar and the title picks nothing.
 * Saving is the filter editor's, not the header's.
 */
export const LibraryHeader = memo(function LibraryHeader({
  query,
  onQuery,
  onSubmitQuery,
  account,

  onOpenAccount,
  title,
  savedFilter,
  countLine,
  edited,

  onOpenShow,
  filterCount,
  onOpenFilter,
  shuffled,
  onShuffle,
  onPlayAll,
  view,
  onView,
  compact,
  large,
  filterOpen,
}: {
  query: string;
  onQuery: (q: string) => void;
  onSubmitQuery: () => void;
  // The account's name: its avatar shows the initial
  account: string;
  onOpenAccount: () => void;
  title: string;
  // The title is a saved filter's name
  savedFilter: boolean;
  countLine: string;
  edited: boolean;

  onOpenShow: () => void;
  filterCount: number;
  onOpenFilter: () => void;
  shuffled: boolean;
  onShuffle: () => void;
  onPlayAll: () => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  // A phone held sideways: one row
  compact: boolean;
  // A large screen (tablet, desktop): the sidebar has the account and the saved filters
  large: boolean;
  // The filter editor is open (the tablet's drawer): Filter shows pressed, and closes it
  filterOpen?: boolean;
}) {
  const active = filterCount > 0;
  if (compact)
    return (
      <View style={styles.compact}>
        <View
          style={[
            styles.search,
            styles.searchCompact,
            query ? styles.searchActive : null,
          ]}
        >
          <Icon name="magnifying-glass" size={16} color={n.textAlpha(55)} />
          <TextInput
            value={query}
            onChangeText={onQuery}
            onSubmitEditing={onSubmitQuery}
            placeholder="Search videos, tags…"
            placeholderTextColor={n.textAlpha(45)}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel="Search"
            style={[styles.searchInput, styles.searchInputCompact]}
          />
          {query ? (
            <Pressable
              onPress={() => onQuery('')}
              accessibilityLabel="Clear search"
              hitSlop={4}
              style={styles.searchClearCompact}
            >
              <Icon name="x" size={14} color={n.textAlpha(60)} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onOpenShow}
          accessibilityRole="button"
          accessibilityLabel={`Show: ${title}`}
          style={({ pressed }) => [
            styles.titleCompact,
            pressed && styles.pressedBg,
          ]}
        >
          <View style={styles.titleLine}>
            {savedFilter ? (
              <Icon
                name="bookmarks-simple"
                fill
                size={14}
                color={n.accent300}
              />
            ) : null}
            <Text style={styles.titleTextCompact} numberOfLines={1}>
              {title}
            </Text>
            <Icon name="caret-down" size={12} color={n.textAlpha(55)} />
          </View>
          <View style={styles.countLine}>
            {edited ? <EditedTag small /> : null}
            <Text style={[styles.count, styles.countCompact]} numberOfLines={1}>
              {countLine}
            </Text>
          </View>
        </Pressable>
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
            size={16}
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
        <View
          accessibilityLabel={
            shuffled ? 'Sort: random' : 'Sort: added, newest first'
          }
          style={styles.icon36}
        >
          <Icon name="sort-descending" size={17} color={n.textAlpha(75)} />
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
        <Pressable
          onPress={onPlayAll}
          accessibilityLabel="Play all"
          style={({ pressed }) => [styles.play, pressed && styles.accentBg]}
        >
          <Icon name="play" fill size={13} color={n.accent200} />
        </Pressable>
        <View style={styles.views}>
          {VIEWS.map((v) => (
            <Pressable
              key={v.view}
              onPress={() => onView(v.view)}
              accessibilityLabel={v.label}
              accessibilityState={{ selected: view === v.view }}
              style={[
                styles.viewButton,
                styles.viewButtonCompact,
                view === v.view && styles.viewOn,
              ]}
            >
              <Icon
                name={v.icon}
                size={15}
                color={view === v.view ? n.accent : n.textAlpha(60)}
              />
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={onOpenAccount}
          accessibilityLabel="Account"
          style={styles.avatarButtonCompact}
        >
          <Avatar name={account} size={32} letters="one" />
        </Pressable>
      </View>
    );
  const searchField = (
    <View
      style={[
        styles.search,
        query ? styles.searchActive : null,
        large && styles.searchLarge,
      ]}
    >
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
  );
  const viewSwitch = (
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
  );
  const titleBlock = (
    <Pressable
      onPress={large ? undefined : onOpenShow}
      disabled={large}
      accessibilityRole={large ? 'header' : 'button'}
      accessibilityLabel={large ? title : `Show: ${title}`}
      style={({ pressed }) => [
        styles.titleButton,
        large && styles.titleButtonLarge,
        pressed && styles.pressedBg,
      ]}
    >
      <View style={styles.titleLine}>
        {savedFilter ? (
          <Icon name="bookmarks-simple" fill size={17} color={n.accent300} />
        ) : null}
        <Text
          style={[styles.title, large && styles.titleLarge]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {large ? null : (
          <Icon name="caret-down" size={14} color={n.textAlpha(55)} />
        )}
      </View>
      <View style={styles.countLine}>
        {edited ? <EditedTag /> : null}
        <Text style={styles.count} numberOfLines={1}>
          {countLine}
        </Text>
      </View>
    </Pressable>
  );
  return (
    <View>
      {large ? (
        // A large screen (1h): the title and the search share one row; no Save here (saving is the editor's)
        <View style={styles.largeTop}>
          {titleBlock}
          {searchField}
        </View>
      ) : (
        <>
          <View style={styles.searchRow}>
            {searchField}
            <Pressable
              onPress={onOpenAccount}
              accessibilityLabel="Account"
              style={styles.avatarButton}
            >
              <Avatar name={account} size={36} letters="one" />
            </Pressable>
          </View>
          <View style={styles.titleRow}>{titleBlock}</View>
        </>
      )}

      <View style={styles.toolbar}>
        <Pressable
          onPress={onOpenFilter}
          accessibilityRole="button"
          accessibilityLabel={
            active ? `Filter, ${filterCount} conditions` : 'Filter'
          }
          style={[
            styles.filterButton,
            active && styles.filterButtonActive,
            filterOpen && styles.filterButtonOpen,
          ]}
        >
          <Icon
            name="funnel-simple"
            fill={filterOpen}
            size={17}
            color={active || filterOpen ? n.accent200 : n.text}
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
        <View style={styles.spacer} />
        <Pressable
          onPress={onPlayAll}
          accessibilityLabel="Play all"
          style={({ pressed }) => [styles.play, pressed && styles.accentBg]}
        >
          <Icon name="play" fill size={14} color={n.accent200} />
        </Pressable>
        {large ? viewSwitch : <ViewMenu view={view} onView={onView} />}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Compact: a phone held sideways, one row
  compact: {
    height: 60,
    paddingLeft: 8,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchCompact: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 170,
    minWidth: 110,
    height: 40,
    paddingLeft: 12,
    paddingRight: 2,
    gap: 8,
  },
  searchInputCompact: { fontSize: 14 },
  searchClearCompact: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCompact: {
    flexShrink: 1,
    maxWidth: 220,
    minWidth: 0,
    height: 44,
    paddingHorizontal: 8,
    justifyContent: 'center',
    borderRadius: n.radiusMd,
    gap: 1,
  },
  titleTextCompact: {
    flexShrink: 1,
    color: n.text,
    fontSize: 15,
    lineHeight: 19,
    fontFamily: fonts.medium,
  },
  countCompact: { fontSize: 11.5 },

  viewButtonCompact: { width: 30, height: 30 },
  avatarButtonCompact: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  accentBg: { backgroundColor: n.accentAlpha(12) },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleLarge: { fontSize: 26, lineHeight: 32 },
  largeTop: {
    paddingTop: 8,
    paddingLeft: 8,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  titleButtonLarge: { flex: 0, flexShrink: 1, maxWidth: '55%' },
  searchLarge: { flex: 1, minWidth: 200, height: 40, borderRadius: 20 },
  title: {
    flexShrink: 1,
    color: n.text,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    fontFamily: fonts.medium,
  },
  countLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: {
    flexShrink: 1,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
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
  filterButtonOpen: {
    borderColor: n.accent,
    backgroundColor: n.accentAlpha(22),
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
  viewMenu: {
    height: 36,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
  },
});
