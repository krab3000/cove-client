import { memo, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { fonts, nocturne as n, roundRadius } from '../../../theme/tokens';
import { Icon, type IconName } from '../../../ui/Icon';
import { Avatar } from '../../../ui/Avatar';
import { EditedTag } from '../../../ui/Chip';
import { Popover, type MenuEntry } from '../../../ui/Menu';

export type LibraryView = 'grid2' | 'grid3' | 'list';

const VIEWS: { view: LibraryView; icon: IconName; label: string }[] = [
  { view: 'grid2', icon: 'squares-four', label: 'Grid' },
  { view: 'grid3', icon: 'dots-nine', label: 'Dense grid' },
  { view: 'list', icon: 'rows', label: 'Feed' },
];

// The tablet's pill menu (design 8g)
const MENU_WIDTH = 320;

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

/** The number of conditions in the pill: accent-800, at its right end. */
function Badge({ count }: { count: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count}</Text>
    </View>
  );
}

/**
 * The Library's header (design turn 8, the filter pill), the same over all three views. One control says what is
 * shown and opens everything about it: the filter pill — a bookmark for a saved filter, else a funnel; the name (the
 * saved filter's, "Videos" for an unnamed filter or a search, "All videos"); at its right end the number of
 * conditions and a caret. On a phone it opens the Show sheet (all videos, saved filters, quick filters, Edit
 * conditions…, Save as new); on a large screen, whose sidebar picks what is shown, a menu under it (Edit conditions…,
 * Save as new filter…, Show all videos). Under the toolbar a caption: Edited, the count, the sort. No title row and no
 * Filter button. Also the search, the avatar (a phone), Shuffle, Play all and the view switch. A phone held sideways
 * (compact) gets all of it in one row, the pill two lines high. Saving is the filter editor's or Save as new.
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
  onEditConditions,
  canSaveNew,
  onSaveNew,
  onShowAll,
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
  // What is shown: a saved filter's name, "Videos" or "All videos"
  title: string;
  // The title is a saved filter's name
  savedFilter: boolean;
  countLine: string;
  edited: boolean;
  // A phone: the pill opens the Show sheet
  onOpenShow: () => void;
  // The filter's conditions (0: none)
  filterCount: number;
  // The filter editor: the large screen's menu (and the pill itself while the editor's drawer is open)
  onEditConditions: () => void;
  canSaveNew: boolean;
  onSaveNew: () => void;
  onShowAll: () => void;
  shuffled: boolean;
  onShuffle: () => void;
  onPlayAll: () => void;
  view: LibraryView;
  onView: (view: LibraryView) => void;
  // A phone held sideways: one row
  compact: boolean;
  // A large screen (tablet, desktop): the sidebar has the account and the saved filters
  large: boolean;
  // The filter editor is open (the tablet's drawer): the pill shows pressed, and closes it
  filterOpen?: boolean;
}) {
  const active = filterCount > 0;
  // Accent while a filter (saved or not) or a search applies; outlined for all videos
  const on = savedFilter || active || title !== 'All videos';
  const pill = useRef<ComponentRef<typeof View>>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const openPill = () => {
    if (!large) return onOpenShow();
    if (filterOpen) return onEditConditions(); // the drawer is open: the pressed pill closes it
    pill.current?.measureInWindow((x, y, _w, h) => setMenu({ x, y: y + h }));
  };
  const menuItems: MenuEntry[] = [
    {
      icon: 'funnel-simple',
      label: 'Edit conditions…',
      detail: active
        ? `${filterCount} condition${filterCount === 1 ? '' : 's'} · the filter drawer`
        : 'Build a filter: the filter drawer',
      onPress: onEditConditions,
    },
    ...(canSaveNew
      ? [
          {
            icon: 'plus' as const,
            label: 'Save as new filter…',
            detail: 'The filter, search, sort and view',
            onPress: onSaveNew,
          },
        ]
      : []),
    ...(on
      ? [
          'rule' as const,
          {
            icon: 'x-circle' as const,
            label: 'Show all videos',
            onPress: onShowAll,
          },
        ]
      : []),
  ];
  const sortLabel = shuffled ? 'Random' : 'Newest';
  const pillIcon = (
    <Icon
      name={savedFilter ? 'bookmarks-simple' : 'funnel-simple'}
      fill={savedFilter || filterOpen}
      size={compact ? 14 : 16}
      color={on || filterOpen ? n.accent200 : n.text}
    />
  );
  const pillEnd = (
    <>
      <View style={styles.spacer} />
      {active ? <Badge count={filterCount} /> : null}
      <Icon
        name="caret-down"
        size={12}
        color={on ? n.accent200 : n.textAlpha(55)}
      />
    </>
  );
  const pillLabel = `Show: ${title}${active ? `, ${filterCount} conditions` : ''}`;

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
        {/* The pill, two lines: what is shown and its conditions; Edited and the count (8e) */}
        <Pressable
          onPress={openPill}
          accessibilityRole="button"
          accessibilityLabel={pillLabel}
          style={({ pressed }) => [
            styles.pill,
            styles.pillCompact,
            on && styles.pillOn,
            pressed && styles.pillPressed,
          ]}
        >
          <View style={styles.pillLine}>
            {pillIcon}
            <Text
              style={[
                styles.pillText,
                styles.pillTextCompact,
                on && styles.pillTextOn,
              ]}
              numberOfLines={1}
            >
              {title}
            </Text>
            {pillEnd}
          </View>
          <View style={styles.countLine}>
            {edited ? <EditedTag small /> : null}
            <Text style={[styles.count, styles.countCompact]} numberOfLines={1}>
              {countLine}
            </Text>
          </View>
        </Pressable>
        <View accessibilityLabel={`Sort: ${sortLabel}`} style={styles.icon36}>
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
        <View style={styles.spacer} />
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
  const pillButton = (
    <Pressable
      ref={pill}
      onPress={openPill}
      accessibilityRole="button"
      accessibilityLabel={pillLabel}
      accessibilityState={{ expanded: !!menu || !!filterOpen }}
      style={({ pressed }) => [
        styles.pill,
        large ? styles.pillLarge : styles.pillPhone,
        on && styles.pillOn,
        filterOpen && styles.pillOpen,
        (pressed || !!menu) && styles.pillPressed,
      ]}
    >
      {pillIcon}
      <Text
        style={[styles.pillText, on && styles.pillTextOn]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {pillEnd}
    </Pressable>
  );
  const shuffleButton = (
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
  );
  const playButton = (
    <Pressable
      onPress={onPlayAll}
      accessibilityLabel="Play all"
      style={({ pressed }) => [styles.play, pressed && styles.accentBg]}
    >
      <Icon name="play" fill size={14} color={n.accent200} />
    </Pressable>
  );
  // Edited, the count, and the sort at its end (Cove's newest added first, or a seeded random order while shuffled)
  const caption = (
    <View style={[styles.caption, large && styles.captionLarge]}>
      {edited ? <EditedTag small /> : null}
      <Text style={styles.count} numberOfLines={1}>
        {countLine}
      </Text>
      <View style={styles.spacer} />
      <View style={styles.sort} accessibilityLabel={`Sort: ${sortLabel}`}>
        <Icon name="sort-descending" size={14} color={n.textAlpha(75)} />
        <Text style={styles.sortText}>{sortLabel}</Text>
      </View>
    </View>
  );
  return (
    <View>
      {large ? (
        // A large screen (8f): the pill where the title was, beside the search, the toolbar's buttons in the same row
        <View style={styles.largeTop}>
          {pillButton}
          {searchField}
          {shuffleButton}
          {playButton}
          {viewSwitch}
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
          <View style={styles.toolbar}>
            {pillButton}
            {shuffleButton}
            {playButton}
            <ViewMenu view={view} onView={onView} />
          </View>
        </>
      )}
      {caption}
      {large ? (
        <Popover
          visible={menu != null}
          anchor={menu}
          onClose={() => setMenu(null)}
          items={menuItems}
          align="left"
          width={MENU_WIDTH}
        />
      ) : null}
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
    borderRadius: roundRadius(44),
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
  pressedBg: { backgroundColor: n.textAlpha(6) },
  accentBg: { backgroundColor: n.accentAlpha(12) },
  largeTop: {
    paddingTop: 8,
    paddingLeft: 16,
    paddingRight: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchLarge: { flex: 1, minWidth: 200, height: 40, borderRadius: 20 },
  // The filter pill
  pill: {
    minWidth: 0,
    paddingLeft: 11,
    paddingRight: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: n.divider,
  },
  pillPhone: { flex: 1, height: 36, borderRadius: roundRadius(36) },
  pillLarge: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 300,
    minWidth: 220,
    height: 40,
    borderRadius: roundRadius(40),
  },
  pillCompact: {
    flexGrow: 0,
    flexShrink: 1,
    maxWidth: 250,
    height: 44,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 1,
    borderRadius: roundRadius(44),
  },
  pillOn: { borderColor: n.accent, backgroundColor: n.accentAlpha(12) },
  pillOpen: { borderColor: n.accent, backgroundColor: n.accentAlpha(22) },
  pillPressed: { backgroundColor: n.accentAlpha(18) },
  pillLine: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  pillText: {
    flexShrink: 1,
    minWidth: 0,
    color: n.text,
    fontSize: 13.5,
    fontFamily: fonts.medium,
  },
  pillTextCompact: { fontSize: 14 },
  pillTextOn: { color: n.accent200 },
  countLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: {
    flexShrink: 1,
    color: n.textAlpha(55),
    fontSize: 12,
    fontFamily: fonts.regular,
    fontVariant: ['tabular-nums'],
  },
  caption: {
    paddingLeft: 18,
    paddingRight: 16,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  captionLarge: { paddingTop: 8, paddingLeft: 28, paddingRight: 20 },
  toolbar: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
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
    height: 28,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sortText: { color: n.textAlpha(75), fontSize: 12, fontFamily: fonts.regular },
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
    borderRadius: roundRadius(36),
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
