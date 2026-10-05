import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { type CoveClient } from '../../api/cove';
import type { FilterExpression, SavedFilter, Video } from '../../api/types';
import { LibraryHeader, type LibraryView } from './components/LibraryHeader';
import {
  LibrarySidebar,
  type SidebarActive,
} from './components/LibrarySidebar';
import { Drawer } from '../../ui/Drawer';
import { VideoDetail } from './components/VideoDetail';
import {
  appendTo,
  emptyTree,
  fieldById,
  newId,
  toWire,
  type Condition,
  type Group,
  type Node,
} from '../filter/model';
import {
  loadSavedFilter,
  newSavedFilter,
  savedFilterChange,
  type LoadedFilter,
} from '../filter/saved';
import { fonts, nocturne as n } from '../../theme/tokens';
import { FilterScreen } from '../filter/FilterScreen';
import {
  createSelection,
  NO_RANGE,
  type IndexRange,
} from '../../lib/selection';

import { prefetchMedia } from '../../platform/player';
import WheelCapture, {
  type WheelEvent,
} from '../../native/WheelCaptureNativeComponent';
import { formatSize } from '../../lib/format';
import { isLarge } from '../../theme/layout';
import { Button } from '../../ui/Button';
import { ErrorText, Spinner } from '../../ui/Text';
import { Layer, useBackHandler } from '../../app/back';
import { prefs } from '../../state/prefs';
import { useSnapshot } from 'valtio';
import { useVideoPages } from '../../data/videoPages';
import { GridRow } from './components/GridRow';
import {
  useAggregate,
  useKeepSavedFilter,
  useSavedFilters,
  useVideoCounts,
} from '../../data/library';
import { AccountSheet } from './components/AccountSheet';
import { SaveAsSheet } from './components/SaveAsSheet';
import { ShowSheet } from './components/ShowSheet';
import { useGridLayout } from './layout';

// Space above the first row.
const TOP = 8;
// One wheel notch scrolls this much of a row (React Native Windows' own step is 120 px).
const WHEEL_ROWS_PER_NOTCH = 0.75;
// Pages load once scrolling rests this long (dragging the scrollbar across the library loads nothing on the way).
const LOAD_DELAY_MS = 120;
// Also load this many screens above and below the visible rows.
const PREFETCH_SCREENS = 1;
// Touch: the card in the middle of the screen plays its preview, switching as soon as another one gets there.
const touch = Platform.OS === 'android';
// The player's Up next: this many videos after the one played.
const UP_NEXT = 20;
// The search applies once typing pauses this long.
const SEARCH_DELAY_MS = 400;
// A large screen (tablet, desktop): the shorter side of the window at least this. It gets the sidebar, the preview
// drawer and the docked filter (design 1h, 2d). No screen lists the filter's conditions; only the editor does.

// The docked filter (2d) applies to the results once editing pauses this long.
const DOCKED_APPLY_MS = 500;

const condition = (
  field: string,
  modifier: Condition['modifier'],
  value: Condition['value'],
  names?: Record<number, string>
): Condition => ({
  kind: 'condition',
  id: newId(),
  field,
  modifier,
  value,
  names,
});

// The built-in shortcuts: real Cove criteria (play count 0, a resume position).
const BUILT_IN: {
  key: string;
  label: string;
  icon: 'eye-slash' | 'play-circle';
  make: () => Condition;
}[] = [
  {
    key: 'unwatched',
    label: 'Unwatched',
    icon: 'eye-slash',
    make: () => condition('playCount', 'equals', 0),
  },
  {
    key: 'progress',
    label: 'In progress',
    icon: 'play-circle',
    make: () => condition('resumeTime', 'greaterThan', 0),
  },
];

/**
 * The Library (design 1f/1g): one screen, three views (2 columns, 3 columns, list) under one header with the filter
 * bar. The grid is virtual in both senses: the list is as long as the library from the first page on (videos/find
 * reports the total), so the scrollbar shows the real size and position, and it can jump anywhere. Rows have a fixed
 * height, so their offsets are known without rendering them. Pages of videos/find load for the rows in view (and a
 * screen around them); rows whose page has not arrived show placeholders. FlatList renders only the rows near the
 * viewport.
 */
export function LibraryScreen({
  client,
  onPlay,
  onLogout,
  previews: previewsAllowed,
}: {
  client: CoveClient;
  // The video, the ones after it in the Library's order (the player's Up next), and where to start (a moment)
  onPlay: (video: Video, upNext: Video[], startAt?: number) => void;
  onLogout: () => void;
  // Off while the player is open over the grid.
  previews: boolean;
}) {
  // --- Filter ------------------------------------------------------------------------------------------------------
  // The rule tree being edited in the filter editor (2b), the tree the grid shows, and what was sent.
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterTree, setFilterTree] = useState<Group>(emptyTree);
  const filterTreeRef = useRef(filterTree);
  filterTreeRef.current = filterTree;
  const [appliedTree, setAppliedTree] = useState<Group>(emptyTree);
  const [applied, setApplied] = useState<FilterExpression | null>(null);
  const appliedRef = useRef<FilterExpression | null>(null);
  // The saved filter loaded, if any (changed or not: see edited).
  const [saved, setSaved] = useState<{
    filter: SavedFilter;
    loaded: LoadedFilter;
  } | null>(null);
  // Cove's search: what is typed, and what the grid shows (once typing pauses).
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const searchedRef = useRef('');
  // The Show sheet (the title), the account sheet (the avatar), naming a new saved filter (Save as…).
  const [sheet, setSheet] = useState<'show' | 'account' | 'saveAs' | null>(
    null
  );

  const [newName, setNewName] = useState('');
  const [sheetError, setSheetError] = useState('');
  const savedFilters = useSavedFilters();
  const keepSavedFilter = useKeepSavedFilter();
  // Cove's seeded random sort while shuffled; null = newest first.
  const [seed, setSeed] = useState<number | null>(null);
  const seedRef = useRef<number | null>(null);
  seedRef.current = seed;
  // The view is the user's: kept across launches
  const view = useSnapshot(prefs).libraryView;
  const setView = useCallback((next: LibraryView) => {
    prefs.libraryView = next;
  }, []);
  // No previews under the filter screen either.
  const previews = previewsAllowed && !filterOpen;

  // Measured, not useWindowDimensions: that one does not follow window resizes on Windows.
  const [width, setWidth] = useState(1000);
  const [height, setHeight] = useState(800);
  // A large screen (design 1h): sidebar and Library, a preview drawer over it. A phone held sideways (6f–6h): the header in one row,
  // two list cards in a row. Both from the window's own size, so split screen, rotation and resizing just work.
  const large = isLarge(width, height);
  const compact = !large && width > height;
  // The Library column's width (the grid's), measured: on a large screen the sidebar and the filter take the rest.
  const [mainWidth, setMainWidth] = useState(0);
  const listWidth = mainWidth || width;
  // The video picked on a large screen, and whether its preview drawer is open (only after a tap on a video).
  const [selected, setSelected] = useState<Video | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useBackHandler(drawerOpen && (() => setDrawerOpen(false)), Layer.drawer);
  const { spec, columns, cardWidth, cardHeight, rowHeight } = useGridLayout(
    listWidth,
    view,
    compact
  );

  // --- Pages ---------------------------------------------------------------------------------------------------
  // The list's pages live in the query cache, keyed by the filter, the search and the order: another of those is
  // another list (answers for the one before are simply not shown). The first page says how many there are.
  const list = useVideoPages({ filter: applied, q: searched, seed });
  const { total, ensure: ensurePages } = list;
  // What went wrong saving (a page that failed to load is the list's own error)
  const [error, setError] = useState('');
  const shownError = list.error || error;

  const rowCount = total == null ? 0 : Math.ceil(total / columns);
  const rows = useMemo(
    () => Array.from({ length: rowCount }, (_, i) => i),
    [rowCount]
  );

  // --- Scrolling -----------------------------------------------------------------------------------------------
  const listRef = useRef<FlatList<number>>(null);
  // The scroll position lives in a ref: scroll events come at 60 Hz, and re-rendering the grid for each one kept
  // the JS thread busy on slow devices. State changes only with the content height or the viewport (the scrollbar
  // and the page loading need those).
  const scrollRef = useRef({ offset: 0, content: 0, viewport: 0 });
  const [scroll, setScrollState] = useState(scrollRef.current);
  const setScroll = useCallback((next: Partial<typeof scrollRef.current>) => {
    const prev = scrollRef.current;
    scrollRef.current = { ...prev, ...next };
    if (
      scrollRef.current.content !== prev.content ||
      scrollRef.current.viewport !== prev.viewport
    )
      setScrollState(scrollRef.current);
  }, []);
  // The first video in view, to keep it in view when the grid reflows (window resize, rotation, another view).
  const anchor = useRef(0);
  const layout = useRef({ columns, rowHeight });
  layout.current = { columns, rowHeight };

  // Loads the pages for the rows in view and a screen around them.
  const loadVisible = useCallback(() => {
    if (total == null) return;
    const { offset, viewport } = scrollRef.current;
    const { columns: cols, rowHeight: rh } = layout.current;
    const margin = viewport * PREFETCH_SCREENS;
    const firstRow = Math.max(0, Math.floor((offset - TOP - margin) / rh));
    const lastRow = Math.floor((offset + viewport + margin - TOP) / rh);
    const first = firstRow * cols;
    const last = Math.min(total - 1, (lastRow + 1) * cols - 1);
    ensurePages(first, last);
  }, [total, ensurePages]);

  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLoad = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(loadVisible, LOAD_DELAY_MS);
  }, [loadVisible]);
  useEffect(
    () => () => {
      if (loadTimer.current) clearTimeout(loadTimer.current);
    },
    []
  );

  // Touch: the card whose preview plays (the one in the middle of the screen), none while the player is open.
  // Kept in Selections, not state: when they change only the cards concerned re-render (see VideoCard).
  const focus = useMemo(() => createSelection<IndexRange>(NO_RANGE), []);
  const held = useMemo(() => createSelection<number | null>(null), []);
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  const setFocused = useCallback(
    (range: IndexRange) => {
      const next = previewsRef.current ? range : NO_RANGE;
      const current = focus.get();
      if (next.first !== current.first || next.last !== current.last)
        focus.set(next);
    },
    [focus]
  );
  // The card in the middle of the screen (a range of one; the plumbing takes any range of cards).
  const visibleCards = useCallback((): IndexRange => {
    if (total == null || total === 0) return NO_RANGE;
    const { offset, viewport } = scrollRef.current;
    const { columns: cols, rowHeight: rh } = layout.current;
    const row = Math.max(0, Math.floor((offset + viewport / 2 - TOP) / rh));
    const index = Math.min(total - 1, row * cols + Math.floor((cols - 1) / 2));
    return { first: index, last: index };
  }, [total]);
  // Touch: the preview clips of the centred card's row and a row either side download ahead (Android caches them), so
  // previews start from a local file. Each video once.
  const prefetched = useRef(new Set<number>());
  const prefetchAround = useCallback(
    (range: IndexRange) => {
      const { columns: cols } = layout.current;
      const firstRow = Math.floor(range.first / cols) - 1;
      const lastRow = Math.floor(range.last / cols) + 1;
      for (let index = firstRow * cols; index < (lastRow + 1) * cols; index++) {
        if (index < 0 || total == null || index >= total) continue;
        const video = list.videoAt(index);
        if (!video || prefetched.current.has(video.id)) continue;
        prefetched.current.add(video.id);
        client.previewAvailable(video).then((has) => {
          if (has) prefetchMedia([client.previewUrl(video)]);
        });
      }
    },
    [client, total, list]
  );
  const updateFocus = useCallback(() => {
    if (!touch) return;
    const range = visibleCards();
    setFocused(range);
    if (range.last >= range.first) prefetchAround(range);
  }, [visibleCards, setFocused, prefetchAround]);
  // The first screen, once the list is there.
  useEffect(() => {
    updateFocus();
  }, [updateFocus, scroll.viewport, view]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      setScroll({
        offset: contentOffset.y,
        content: contentSize.height,
        viewport: layoutMeasurement.height,
      });
      const { columns: cols, rowHeight: rh } = layout.current;
      anchor.current =
        Math.max(0, Math.floor((contentOffset.y - TOP + rh / 2) / rh)) * cols;
      scheduleLoad();
      updateFocus();
    },
    [scheduleLoad, updateFocus, setScroll]
  );

  // The pages in view (the first page asks itself)
  useEffect(() => {
    loadVisible();
  }, [loadVisible, scroll.viewport]);

  // Reflow: the same video stays at the top.
  const lastLayout = useRef({ columns, rowHeight });
  useEffect(() => {
    const prev = lastLayout.current;
    lastLayout.current = { columns, rowHeight };
    if (prev.columns === columns && prev.rowHeight === rowHeight) return;
    const row = Math.floor(anchor.current / columns);
    listRef.current?.scrollToOffset({
      offset: row * rowHeight,
      animated: false,
    });
    scheduleLoad();
  }, [columns, rowHeight, scheduleLoad]);

  const scrollTo = useCallback((offset: number, animated: boolean) => {
    const { content, viewport } = scrollRef.current;
    const clamped = Math.min(
      Math.max(0, offset),
      Math.max(0, content - viewport)
    );
    listRef.current?.scrollToOffset({ offset: clamped, animated });
    return clamped;
  }, []);

  // Where wheel scrolling is heading: consecutive notches add up while the animation runs.
  const wheelTarget = useRef<{ offset: number; at: number } | null>(null);
  const onWheel = useCallback(
    (e: NativeSyntheticEvent<WheelEvent>) => {
      const now = Date.now();
      const target = wheelTarget.current;
      const from =
        target && now - target.at < 400
          ? target.offset
          : scrollRef.current.offset;
      const step =
        (e.nativeEvent.delta / 120) * rowHeight * WHEEL_ROWS_PER_NOTCH;
      wheelTarget.current = { offset: scrollTo(from - step, true), at: now };
    },
    [rowHeight, scrollTo]
  );

  // Each row of the grid sits in a WheelCapture (Windows), which hands wheel turns to onWheel.
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;
  const Cell = useMemo(
    () =>
      function WheelCell({
        children,
        style,
        onLayout,
      }: {
        children: ReactNode;
        style?: StyleProp<ViewStyle>;
        onLayout?: (e: LayoutChangeEvent) => void;
      }) {
        // The list measures cells through a plain View: the custom component's layout events carry no data.
        return (
          <View style={style} onLayout={onLayout}>
            <WheelCapture onWheel={(e) => onWheelRef.current(e)}>
              {children}
            </WheelCapture>
          </View>
        );
      },
    []
  );

  // The same list again from the server (pull to refresh, Refresh library)
  const { refresh: refreshList } = list;
  const refresh = useCallback(() => {
    setError('');
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    refreshList();
  }, [refreshList]);

  // A new filter or order: the grid starts over from the top with its results.
  const restart = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    anchor.current = 0;
    wheelTarget.current = null;
    focus.set(NO_RANGE);
    held.set(null);
    setSelected(null);
    setDrawerOpen(false);
    setError('');
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [focus, held]);
  const applyFilter = useCallback(
    (filter: FilterExpression | null) => {
      appliedRef.current = filter;
      setApplied(filter);
      restart();
    },
    [restart]
  );

  // The count line: count, total duration and size of what the filter and search match.
  const aggregate = useAggregate(applied, searched);

  // The search: the grid follows once typing pauses (or at once on the keyboard's search key).
  const applySearch = useCallback(
    (text: string) => {
      const q = text.trim();
      if (q === searchedRef.current) return;
      searchedRef.current = q;
      setSearched(q);
      restart();
    },
    [restart]
  );
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onQuery = useCallback(
    (text: string) => {
      setQuery(text);
      if (searchTimer.current) clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(
        () => applySearch(text),
        text ? SEARCH_DELAY_MS : 0
      );
    },
    [applySearch]
  );
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    []
  );
  /** Sets the search without waiting (the grid restarts with whatever applies next). */
  const setSearchNow = (text: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setQuery(text);
    searchedRef.current = text.trim();
    setSearched(text.trim());
  };

  /** Shows a changed tree and its results; a loaded saved filter is now Edited. */
  const commit = useCallback(
    (tree: Group) => {
      setFilterTree(tree);
      setAppliedTree(tree);
      if (!tree.children.length) setSaved(null);
      applyFilter(toWire(tree));
    },
    [applyFilter]
  );

  // Saved filters keep ids only: the names for the chips come from Cove, after the results.
  const fillNames = useCallback(
    async (tree: Group) => {
      const missing: Condition[] = [];
      const walk = (node: Node) => {
        if (node.kind === 'group') node.children.forEach(walk);
        else if (
          fieldById(node.field).type === 'multiId' &&
          Array.isArray(node.value) &&
          node.value.some((id) => !node.names?.[id])
        )
          missing.push(node);
      };
      walk(tree);
      if (!missing.length) return;
      const found = new Map<string, Record<number, string>>();
      await Promise.all(
        missing.map(async (c) => {
          const kind = fieldById(c.field).lookup!;
          const names = { ...c.names };
          await Promise.all(
            (c.value as number[]).map(async (id) => {
              if (!names[id])
                names[id] = await client
                  .entityName(kind, id)
                  .catch(() => `#${id}`);
            })
          );
          found.set(c.id, names);
        })
      );
      // The same tree with names: chips re-render, nothing is fetched again.
      const name = (node: Node): Node =>
        node.kind === 'group'
          ? { ...node, children: node.children.map(name) }
          : found.has(node.id)
            ? { ...node, names: found.get(node.id) }
            : node;
      const named = name(tree) as Group;
      setAppliedTree((t) => (t.id === tree.id ? named : t));
      setFilterTree((t) => (t.id === tree.id ? named : t));
    },
    [client]
  );

  const loadSaved = useCallback(
    (filter: SavedFilter) => {
      const loaded = loadSavedFilter(filter);
      setSaved({ filter, loaded });
      setSearchNow(loaded.q);
      setFilterTree(loaded.tree);
      setAppliedTree(loaded.tree);
      // The saved display mode: a list opens the list; a grid keeps the grid you use
      if (loaded.view === 'list') setView('list');
      else if (loaded.view === 'grid') {
        if (prefs.libraryView === 'list') setView('grid3');
      }
      applyFilter(loaded.wire);
      fillNames(loaded.tree);
    },
    [applyFilter, fillNames, setView]
  );

  // What saving saves: the tree in the filter editor while it is open (the phone's draft, or the tablet drawer's before
  // it applies), else the filter shown. Saving from the editor also shows it.
  const savingTree = filterOpen ? filterTree : appliedTree;
  const showSaved = useCallback(
    (tree: Group) => {
      const wire = toWire(tree);
      if (JSON.stringify(wire) === JSON.stringify(appliedRef.current)) return;
      setAppliedTree(tree);
      applyFilter(wire);
    },
    [applyFilter]
  );
  const save = useCallback(async () => {
    if (!saved) return;
    try {
      const updated = await client.updateSavedFilter(
        saved.filter.id,
        savedFilterChange(
          saved.filter,
          savingTree,
          view === 'list' ? 'list' : 'grid',
          searched
        )
      );
      keepSavedFilter(updated);
      setSaved({ filter: updated, loaded: loadSavedFilter(updated) });
      showSaved(savingTree);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, saved, savingTree, showSaved, view, searched, keepSavedFilter]);

  // Save as…: the filter, search and view as a new saved filter, under a name.
  const saveAs = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      const created = await client.createSavedFilter(
        newSavedFilter(
          newName,
          savingTree,
          view === 'list' ? 'list' : 'grid',
          searched
        )
      );
      keepSavedFilter(created);
      setSaved({ filter: created, loaded: loadSavedFilter(created) });
      showSaved(savingTree);
      setSheet(null);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : String(e));
    }
  }, [client, newName, savingTree, showSaved, view, searched, keepSavedFilter]);

  // The filter screen's Show / Play: the tree being edited becomes the one shown.
  const showFilter = useCallback(
    (filter: FilterExpression | null) => {
      const tree = filterTreeRef.current;
      setAppliedTree(tree);
      if (!filter) setSaved(null);
      applyFilter(filter);
      setFilterOpen(false);
    },
    [applyFilter]
  );
  // A card's video, with the loaded videos after it as Up next.
  const playVideo = useCallback(
    (video: Video, startAt?: number) => {
      onPlay(video, list.after(video.id, UP_NEXT), startAt);
    },
    [onPlay, list]
  );
  // Large screen: a tap opens the preview drawer on the video (or switches it), a tap on the one it shows plays it.
  // Elsewhere a tap plays.
  const largeRef = useRef(large);
  largeRef.current = large;
  const shownRef = useRef<Video | null>(null);
  shownRef.current = drawerOpen ? selected : null;
  const pressVideo = useCallback(
    (video: Video) => {
      if (!largeRef.current || shownRef.current?.id === video.id)
        playVideo(video);
      else {
        // One drawer at a time: the preview takes the filter editor's place
        setFilterOpen(false);
        setSelected(video);
        setDrawerOpen(true);
      }
    },
    [playVideo]
  );
  const playFirst = useCallback(
    (filter: FilterExpression | null) => {
      client
        .findVideos(
          1,
          UP_NEXT + 1,
          filter,
          seedRef.current,
          searchedRef.current
        )
        .then(
          (result) => {
            const [first, ...rest] = result.items;
            if (first) onPlay(first, rest);
          },
          () => {}
        );
    },
    [client, onPlay]
  );
  const playFilter = useCallback(
    (filter: FilterExpression | null) => {
      showFilter(filter);
      playFirst(filter);
    },
    [showFilter, playFirst]
  );
  const openFilter = useCallback(() => {
    setFilterTree(appliedTree);
    setFilterOpen(true);
    setDrawerOpen(false);
  }, [appliedTree]);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const docked = large && filterOpen;
  useEffect(() => {
    if (!docked) return;
    const wire = toWire(filterTree);
    if (JSON.stringify(wire) === JSON.stringify(appliedRef.current)) return;
    const timer = setTimeout(() => {
      setAppliedTree(filterTree);
      if (!filterTree.children.length) setSaved(null);
      applyFilter(wire);
    }, DOCKED_APPLY_MS);
    return () => clearTimeout(timer);
  }, [docked, filterTree, applyFilter]);

  // A person or tag from a list card: one more condition, unless the filter has it already.
  const addEntity = useCallback(
    (field: 'tags' | 'performers', entity: { id: number; name: string }) => {
      const has = appliedTree.children.some(
        (c) =>
          c.kind === 'condition' &&
          c.field === field &&
          (c.modifier === 'includes' || c.modifier === 'includesAll') &&
          Array.isArray(c.value) &&
          (c.value as number[]).includes(entity.id)
      );
      if (has) return;
      commit(
        appendTo(
          appliedTree,
          appliedTree.id,
          condition(field, 'includes', [entity.id], {
            [entity.id]: entity.name,
          })
        )
      );
    },
    [appliedTree, commit]
  );
  const onAddTag = useCallback(
    (tag: { id: number; name: string }) => addEntity('tags', tag),
    [addEntity]
  );
  const onAddPerformer = useCallback(
    (p: { id: number; name: string }) => addEntity('performers', p),
    [addEntity]
  );

  // Favorite and Save for later: shown at once, undone if Cove says no.
  const shuffle = useCallback(() => {
    const next =
      seedRef.current == null ? Math.floor(Math.random() * 1e9) : null;
    seedRef.current = next;
    setSeed(next);
    restart();
  }, [restart]);

  const { retry: retryList } = list;
  const retry = useCallback(() => {
    setError('');
    retryList();
    scheduleLoad();
  }, [retryList, scheduleLoad]);

  // --- The header (design turn 6) ------------------------------------------------------------------------------
  const conditions = appliedTree.children.length;
  // Parts of a saved filter the app can't show still apply (and count) until the filter changes.
  const hidden =
    saved &&
    saved.loaded.dropped &&
    JSON.stringify(applied) === JSON.stringify(saved.loaded.wire)
      ? saved.loaded.dropped
      : 0;
  // Changed since loaded, and not back to what was saved (adding a condition and removing it again is no edit).
  const edited =
    !!saved &&
    (JSON.stringify(applied) !== JSON.stringify(saved.loaded.wire) ||
      searched !== saved.loaded.q.trim());
  const title = saved
    ? saved.filter.name
    : conditions || searched
      ? 'Videos'
      : 'All videos';
  // The filter editor's Save (the only one): Save for a changed saved filter, Save as… for an unnamed filter or a
  // search, judged by what it would save. A saved filter with parts the app can't show isn't saved from here: they
  // would be lost; nor is an empty filter saved over one.
  const savingEdited =
    !!saved &&
    (JSON.stringify(toWire(savingTree)) !== JSON.stringify(saved.loaded.wire) ||
      searched !== saved.loaded.q.trim());
  const saveLabel = saved
    ? savingEdited && !saved.loaded.dropped && savingTree.children.length
      ? 'Save'
      : null
    : savingTree.children.length || searched
      ? 'Save as…'
      : null;
  const openSaveAs = useCallback(() => {
    setNewName('');
    setSheetError('');
    setSheet('saveAs');
  }, []);
  const showAll = useCallback(() => {
    setSheet(null);
    setSaved(null);
    setSearchNow('');
    commit(emptyTree());
  }, [commit]);
  const showQuick = useCallback(
    (make: () => Condition) => {
      setSheet(null);
      setSaved(null);
      commit({ ...emptyTree(), children: [make()] });
    },
    [commit]
  );
  // The Show sheet's counts: all videos, and each saved filter as it runs (with its search).
  const countEntries = useMemo(
    () => [
      { key: 'all', filter: null },
      ...savedFilters.map((f) => {
        const loaded = loadSavedFilter(f);
        return { key: `saved-${f.id}`, filter: loaded.wire, q: loaded.q };
      }),
    ],
    [savedFilters]
  );
  const sheetCounts = useVideoCounts(countEntries, sheet === 'show' || large);
  const quickOn = (c: Condition) =>
    !saved &&
    conditions === 1 &&
    JSON.stringify(toWire(appliedTree)) ===
      JSON.stringify(toWire({ ...emptyTree(), children: [c] }));

  const count = aggregate?.count ?? total;
  const countLine =
    count == null
      ? ' '
      : [
          `${count.toLocaleString('en-US')} videos`,
          aggregate
            ? `${Math.round(aggregate.duration / 3600).toLocaleString('en-US')} h`
            : null,
          aggregate ? formatSize(aggregate.fileSize) : null,
        ]
          .filter(Boolean)
          .join(' · ');

  // --- Touch preview -------------------------------------------------------------------------------------------
  // Press and hold a card. It lasts while the finger is down, also when the finger goes on to scroll the list: the
  // content moves with the finger, so the card stays under it. The card's press ends when the list takes the
  // touch over, so then only the end of the drag (finger up) stops the preview.
  // Previews off (the player is open over the grid): none playing; back on: the centred card again.
  useEffect(() => {
    if (!previews) {
      focus.set(NO_RANGE);
      held.set(null);
    } else {
      updateFocus();
    }
  }, [previews, focus, held, updateFocus]);
  const dragging = useRef(false);
  const onHold = useCallback(
    (video: Video) => held.set(previewsRef.current ? video.id : null),
    [held]
  );
  const onRelease = useCallback(
    (video: Video) => {
      // The scroll drag, if this press turned into one, starts right after the press ends.
      setTimeout(() => {
        if (!dragging.current && held.get() === video.id) held.set(null);
      }, 80);
    },
    [held]
  );

  // A row is a GridRow: it reads its own page(s), so a page arriving re-renders its rows only
  const rowProps = useMemo(
    () => ({
      columns,
      total: total ?? 0,
      pages: list.pages,
      view,
      cardWidth,
      cardHeight,
      rowHeight,
      gapX: spec.gapX,
      padX: spec.padX,
      gapY: spec.gapY,
      client,
      selectedId: large && drawerOpen && selected ? selected.id : null,
      onPress: pressVideo,
      onAddTag,
      onAddPerformer,
      focus,
      held,
      onHold,
      onRelease,
    }),
    [
      columns,
      total,
      list.pages,
      view,
      cardWidth,
      cardHeight,
      rowHeight,
      spec,
      client,
      large,
      drawerOpen,
      selected,
      pressVideo,
      onAddTag,
      onAddPerformer,
      focus,
      held,
      onHold,
      onRelease,
    ]
  );
  const renderRow = useCallback(
    ({ item: row }: { item: number }) => <GridRow row={row} {...rowProps} />,
    [rowProps]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<number> | null | undefined, index: number) => ({
      length: rowHeight,
      offset: TOP + rowHeight * index,
      index,
    }),
    [rowHeight]
  );

  // The sidebar's mark: what the Library shows
  const quickKey = BUILT_IN.find((q) => quickOn(q.make()))?.key;
  const active: SidebarActive = saved
    ? { kind: 'saved', id: saved.filter.id }
    : quickKey
      ? { kind: 'quick', key: quickKey }
      : !conditions && !searched
        ? { kind: 'all' }
        : { kind: 'other' };
  const savedCounts = Object.fromEntries(
    savedFilters.map((f) => [f.id, sheetCounts[`saved-${f.id}`]])
  ) as Record<number, number>;

  return (
    <View
      style={[styles.screen, large && styles.screenLarge]}
      onLayout={(e) => {
        setWidth(Math.round(e.nativeEvent.layout.width));
        setHeight(Math.round(e.nativeEvent.layout.height));
      }}
    >
      {large ? (
        <LibrarySidebar
          server={client.server}
          username={client.username}
          allCount={sheetCounts.all ?? null}
          active={active}
          quick={[
            {
              key: 'progress',
              label: 'Continue watching',
              icon: 'play-circle',
            },
            { key: 'unwatched', label: 'Unwatched', icon: 'eye-slash' },
          ]}
          saved={savedFilters}
          savedCounts={savedCounts}
          canSaveNew={!saved && !!(conditions || searched)}
          onAll={showAll}
          onQuick={(key) => {
            const q = BUILT_IN.find((b) => b.key === key);
            if (q) showQuick(q.make);
          }}
          onSaved={loadSaved}
          onSaveNew={openSaveAs}
          onAccount={() => setSheet('account')}
        />
      ) : null}
      <View
        style={styles.main}
        onLayout={(e) => setMainWidth(Math.round(e.nativeEvent.layout.width))}
        // A tap on the Library outside a video (and its controls) closes the preview
        onStartShouldSetResponder={() => drawerOpen || docked}
        onResponderRelease={() => {
          setDrawerOpen(false);
          setFilterOpen(false);
        }}
      >
        <LibraryHeader
          query={query}
          onQuery={onQuery}
          onSubmitQuery={() => applySearch(query)}
          account={client.username}
          onOpenAccount={() => setSheet('account')}
          title={title}
          savedFilter={!!saved}
          countLine={countLine}
          edited={edited}
          onOpenShow={() => setSheet('show')}
          filterCount={conditions + hidden}
          onOpenFilter={filterOpen ? closeFilter : openFilter}
          shuffled={seed != null}
          onShuffle={shuffle}
          onPlayAll={() => playFirst(applied)}
          view={view}
          onView={setView}
          compact={compact}
          large={large}
          filterOpen={docked}
        />
        {shownError ? (
          <View style={styles.errorRow}>
            <ErrorText style={styles.error}>{shownError}</ErrorText>
            <Button label="Retry" variant="text" size="sm" onPress={retry} />
          </View>
        ) : null}
        <View style={styles.listArea}>
          {total == null && !shownError ? (
            <View style={styles.center}>
              <Spinner />
            </View>
          ) : null}
          {total === 0 ? (
            <View style={styles.center}>
              <Text style={styles.empty}>No videos match this filter.</Text>
            </View>
          ) : null}
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(row) => String(row)}
            renderItem={renderRow}
            getItemLayout={getItemLayout}
            extraData={rowProps}
            contentContainerStyle={styles.content}
            onScroll={onScroll}
            onScrollBeginDrag={() => {
              dragging.current = true;
            }}
            onScrollEndDrag={() => {
              dragging.current = false;
              held.set(null); // finger up
            }}
            // RNW's native scrollbar hides itself for good once the content fits the viewport (as it does before
            // the first page arrives): only a change of this prop makes it check again. So it flips with the overflow.
            showsVerticalScrollIndicator={scroll.content > scroll.viewport}
            scrollEventThrottle={16}
            onContentSizeChange={(_, h) => setScroll({ content: h })}
            onLayout={(e) => {
              // Read now: the event is released once the handler returns, before the updater runs.
              const viewport = e.nativeEvent.layout.height;
              setScroll({ viewport });
            }}
            CellRendererComponent={Platform.OS === 'windows' ? Cell : undefined}
            refreshing={list.refreshing}
            onRefresh={refresh}
            initialNumToRender={4}
            maxToRenderPerBatch={4}
            windowSize={5}
          />
        </View>
        {large && selected ? (
          <Drawer open={drawerOpen && !filterOpen} onClose={closeDrawer}>
            <VideoDetail
              client={client}
              video={selected}

              onPlay={playVideo}

              onAddTag={onAddTag}
              onAddPerformer={onAddPerformer}
              onClose={closeDrawer}
            />
          </Drawer>
        ) : null}
        {large ? (
          // The filter editor (2d): over the Library like the preview; the results behind it follow the tree
          <Drawer open={filterOpen} onClose={closeFilter} width={420}>
            <FilterScreen
              docked
              client={client}
              tree={filterTree}
              onChange={setFilterTree}
              applied={applied}
              onApply={showFilter}
              onPlayAll={playFilter}
              onClose={closeFilter}
              title={saved?.filter.name}
              savedEdited={savingEdited}
              saveLabel={saveLabel}
              onSave={saved ? save : openSaveAs}
            />
          </Drawer>
        ) : null}
      </View>
      {filterOpen && !large ? (
        <FilterScreen
          client={client}
          tree={filterTree}
          onChange={setFilterTree}
          applied={applied}
          onApply={showFilter}
          onPlayAll={playFilter}
          onClose={closeFilter}
          title={saved?.filter.name}
          saveLabel={saveLabel}
          onSave={saved ? save : openSaveAs}
        />
      ) : null}

      <ShowSheet
        visible={sheet === 'show'}
        onClose={() => setSheet(null)}
        counts={sheetCounts}
        allChecked={!saved && !conditions && !searched}
        onAll={showAll}
        savedFilters={savedFilters}
        savedId={saved?.filter.id ?? null}
        onSaved={loadSaved}
        quick={BUILT_IN.map((q) => ({
          key: q.key,
          label: q.label,
          icon: q.icon,
          checked: quickOn(q.make()),
          onPress: () => showQuick(q.make),
        }))}
        canSaveNew={!!(conditions || searched)}
        onSaveNew={openSaveAs}
      />
      <AccountSheet
        visible={sheet === 'account'}
        onClose={() => setSheet(null)}
        username={client.username}
        server={client.server}
        onRefresh={refresh}
        onLogout={onLogout}
      />
      <SaveAsSheet
        visible={sheet === 'saveAs'}
        onClose={() => setSheet(null)}
        name={newName}
        onName={(t) => {
          setNewName(t);
          setSheetError('');
        }}
        error={sheetError}
        onSave={saveAs}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: n.bg },
  screenLarge: { flexDirection: 'row' },
  main: { flex: 1, minWidth: 0 },
  listArea: { flex: 1 },
  center: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: { color: n.textAlpha(55), fontSize: 14, fontFamily: fonts.regular },
  // Rows carry the gap below them (part of their fixed height).
  content: { paddingTop: TOP },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: n.radiusMd,
    backgroundColor: n.surface,
  },
  error: { flex: 1 },
});
