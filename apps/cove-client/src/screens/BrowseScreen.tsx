import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  BackHandler,
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
import { primaryFile, type CoveClient } from '../api/cove';
import type {
  Aggregate,
  FilterExpression,
  SavedFilter,
  Video,
} from '../api/types';
import { LibraryHeader, type LibraryView } from '../components/LibraryHeader';
import {
  LibrarySidebar,
  type SidebarActive,
} from '../components/LibrarySidebar';
import { Drawer } from '../components/Drawer';
import { VideoDetail } from '../components/VideoDetail';
import {
  Sheet,
  SheetHeading,
  SheetRow,
  SheetRule,
  SheetSection,
} from '../components/Sheet';
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
import { fonts, nocturne as n } from '../theme/tokens';
import { FilterScreen } from './FilterScreen';
import { createSelection, NO_RANGE, type IndexRange } from '../lib/selection';
import {
  PlaceholderCard,
  tileTextHeight,
  VideoCard,
} from '../components/VideoCard';
import {
  listCardHeight,
  VideoRow,
  type Personal,
} from '../components/VideoRow';
import { prefetchMedia } from '../player';
import WheelCapture, {
  type WheelEvent,
} from '../native/WheelCaptureNativeComponent';
import { formatSize, initialOf } from '../lib/format';
import { isLarge } from '../theme/layout';
import { Button } from '../ui/Button';
import { ErrorText, Spinner, StatusDot } from '../ui/Text';
import { TextField } from '../ui/TextField';

const PER_PAGE = 40;
// Space above the first row.
const TOP = 8;
// The three views of the Library (design 1f/1g). A phone gets the named number of columns; a wider window fits
// more, none narrower than `target`.
const VIEWS: Record<
  LibraryView,
  { min: number; target: number; padX: number; gapX: number; gapY: number }
> = {
  grid2: { min: 2, target: 300, padX: 16, gapX: 12, gapY: 16 },
  grid3: { min: 3, target: 190, padX: 16, gapX: 8, gapY: 12 },
  list: { min: 1, target: 520, padX: 20, gapX: 20, gapY: 28 },
};
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
// A phone held sideways: the list view's cards get this narrow, two in a row (one would be taller than the screen).
const LIST_TARGET_COMPACT = 320;

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
export function BrowseScreen({
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
  // The rule tree being edited in the filter screen (2b), the tree the grid shows (its chips), and what was sent.
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
  const [sheetCounts, setSheetCounts] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState('');
  const [sheetError, setSheetError] = useState('');
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  // Cove's seeded random sort while shuffled; null = newest first.
  const [seed, setSeed] = useState<number | null>(null);
  const seedRef = useRef<number | null>(null);
  seedRef.current = seed;
  const [view, setView] = useState<LibraryView>('grid3');
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
  useEffect(() => {
    if (!drawerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setDrawerOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [drawerOpen]);
  const spec = useMemo(
    () =>
      view === 'list' && compact
        ? { ...VIEWS.list, target: LIST_TARGET_COMPACT }
        : VIEWS[view],
    [view, compact]
  );
  const columns = Math.max(
    spec.min,
    Math.floor(
      (listWidth - 2 * spec.padX + spec.gapX) / (spec.target + spec.gapX)
    )
  );
  const cardWidth = Math.floor(
    (listWidth - 2 * spec.padX - spec.gapX * (columns - 1)) / columns
  );
  const cardHeight =
    view === 'list'
      ? listCardHeight(cardWidth)
      : Math.round((cardWidth * 9) / 16) + tileTextHeight(view === 'grid2');
  const rowHeight = cardHeight + spec.gapY;

  // --- Pages ---------------------------------------------------------------------------------------------------
  // Loaded pages (0-based) of PER_PAGE videos, and the user's own data about their videos. Kept in refs; `version`
  // re-renders when something arrives.
  const pages = useRef(new Map<number, Video[]>());
  const personal = useRef(new Map<number, Personal>());
  const pending = useRef(new Set<number>());
  const failed = useRef(new Set<number>());
  const generation = useRef(0);
  const [version, setVersion] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Rating, favorite, play count, resume position and Save for later: not part of the videos, asked per page.
  const loadPersonal = useCallback(
    async (videos: Video[]) => {
      const ids = videos.map((v) => v.id);
      if (!ids.length) return;
      const [engagement, later] = await Promise.all([
        client.engagement(ids).catch(() => []),
        client.savedForLater(ids).catch(() => new Set<number>()),
      ]);
      const byId = new Map(engagement.map((e) => [e.hostId, e]));
      for (const video of videos) {
        const e = byId.get(video.id);
        const duration = primaryFile(video)?.duration ?? 0;
        personal.current.set(video.id, {
          favorite: !!e?.isFavorite,
          savedForLater: later.has(video.id),
          rating: e?.rating ?? null,
          playCount: e?.playCount ?? 0,
          progress:
            e && duration > 0 ? Math.min(1, e.resumeTime / duration) : 0,
        });
      }
      setVersion((v) => v + 1);
    },
    [client]
  );

  const loadPage = useCallback(
    async (page: number) => {
      if (pages.current.has(page) || pending.current.has(page)) return;
      const gen = generation.current;
      pending.current.add(page);
      failed.current.delete(page);
      try {
        const result = await client.findVideos(
          page + 1,
          PER_PAGE,
          appliedRef.current,
          seedRef.current,
          searchedRef.current
        );
        if (gen !== generation.current) return; // refreshed meanwhile
        pages.current.set(page, result.items);
        setTotal(result.totalCount);
        setError('');
        loadPersonal(result.items);
      } catch (e) {
        if (gen !== generation.current) return;
        failed.current.add(page);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (gen === generation.current) {
          pending.current.delete(page);
          setVersion((v) => v + 1);
          setRefreshing(false);
        }
      }
    },
    [client, loadPersonal]
  );

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
    for (
      let page = Math.floor(first / PER_PAGE);
      page <= Math.floor(last / PER_PAGE);
      page++
    ) {
      if (!failed.current.has(page)) loadPage(page);
    }
  }, [total, loadPage]);

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
        const video = pages.current.get(Math.floor(index / PER_PAGE))?.[
          index % PER_PAGE
        ];
        if (!video || prefetched.current.has(video.id)) continue;
        prefetched.current.add(video.id);
        client.previewAvailable(video).then((has) => {
          if (has) prefetchMedia([client.previewUrl(video)]);
        });
      }
    },
    [client, total]
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
    [scheduleLoad, updateFocus]
  );

  // The first page tells the total; then the pages in view.
  useEffect(() => {
    loadPage(0);
  }, [loadPage]);
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

  const refresh = useCallback(() => {
    generation.current++;
    pages.current = new Map();
    personal.current = new Map();
    pending.current = new Set();
    failed.current = new Set();
    setRefreshing(true);
    setError('');
    setTotal(null);
    setVersion((v) => v + 1);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    loadPage(0);
  }, [loadPage]);

  // A new filter or order: the grid starts over from the top with its results.
  const restart = useCallback(() => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    anchor.current = 0;
    wheelTarget.current = null;
    focus.set(NO_RANGE);
    held.set(null);
    setSelected(null);
    setDrawerOpen(false);
    refresh();
  }, [refresh, focus, held]);
  const applyFilter = useCallback(
    (filter: FilterExpression | null) => {
      appliedRef.current = filter;
      setApplied(filter);
      restart();
    },
    [restart]
  );

  // The count line: count, total duration and size of what the filter and search match.
  useEffect(() => {
    let alive = true;
    setAggregate(null);
    client.aggregateVideos(applied, searched).then(
      (a) => alive && setAggregate(a),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [client, applied, searched]);

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

  // The user's saved filters (the Show sheet lists them).
  useEffect(() => {
    client.savedFilters().then(setSavedFilters, () => {});
  }, [client]);

  /** Shows a changed tree: its chips, its results; a loaded saved filter is now Edited. */
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
      else if (loaded.view === 'grid')
        setView((v) => (v === 'list' ? 'grid3' : v));
      applyFilter(loaded.wire);
      fillNames(loaded.tree);
    },

    [applyFilter, fillNames]
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
      setSavedFilters((list) =>
        list.map((f) => (f.id === updated.id ? updated : f))
      );
      setSaved({ filter: updated, loaded: loadSavedFilter(updated) });
      showSaved(savingTree);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, saved, savingTree, showSaved, view, searched]);

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
      setSavedFilters((list) =>
        [...list, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      setSaved({ filter: created, loaded: loadSavedFilter(created) });
      showSaved(savingTree);
      setSheet(null);
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : String(e));
    }
  }, [client, newName, savingTree, showSaved, view, searched]);

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
      const after: Video[] = [];
      let found = false;
      const keys = [...pages.current.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        for (const v of pages.current.get(k)!) {
          if (found) after.push(v);
          else if (v.id === video.id) found = true;
          if (after.length >= UP_NEXT) break;
        }
        if (after.length >= UP_NEXT) break;
      }
      onPlay(video, after, startAt);
    },
    [onPlay]
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
  const togglePersonal = useCallback(
    (video: Video, key: 'favorite' | 'savedForLater') => {
      const before = personal.current.get(video.id);
      if (!before) return;
      const on = !before[key];
      personal.current.set(video.id, { ...before, [key]: on });
      setVersion((v) => v + 1);
      const call =
        key === 'favorite'
          ? client.setFavorite(video.id, on)
          : client.setSavedForLater(video.id, on);
      call.catch((e) => {
        personal.current.set(video.id, before);
        setVersion((v) => v + 1);
        setError(e instanceof Error ? e.message : String(e));
      });
    },
    [client]
  );
  const onToggleFavorite = useCallback(
    (video: Video) => togglePersonal(video, 'favorite'),
    [togglePersonal]
  );
  const onToggleLater = useCallback(
    (video: Video) => togglePersonal(video, 'savedForLater'),
    [togglePersonal]
  );

  const shuffle = useCallback(() => {
    const next =
      seedRef.current == null ? Math.floor(Math.random() * 1e9) : null;
    seedRef.current = next;
    setSeed(next);
    restart();
  }, [restart]);

  const retry = useCallback(() => {
    failed.current = new Set();
    setError('');
    if (total == null) loadPage(0);
    else loadVisible();
  }, [total, loadPage, loadVisible]);

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
  useEffect(() => {
    if (sheet !== 'show' && !large) return;
    let alive = true;
    const counted = (key: string, num: number) =>
      alive && setSheetCounts((c) => ({ ...c, [key]: num }));
    client.countVideos(null).then(
      (num) => counted('all', num),
      () => {}
    );
    for (const f of savedFilters) {
      const loaded = loadSavedFilter(f);
      client.countVideos(loaded.wire, loaded.q).then(
        (num) => counted(`saved-${f.id}`, num),
        () => {}
      );
    }
    return () => {
      alive = false;
    };
  }, [sheet, large, client, savedFilters]);
  const quickOn = (c: Condition) =>
    !saved &&
    conditions === 1 &&
    JSON.stringify(toWire(appliedTree)) ===
      JSON.stringify(toWire({ ...emptyTree(), children: [c] }));
  const videos = (num: number | undefined) =>
    num == null ? '…' : `${num.toLocaleString('en-US')} videos`;
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

  const renderRow = useCallback(
    ({ item: row }: { item: number }) => {
      const cards: ReactNode[] = [];
      for (let c = 0; c < columns; c++) {
        const index = row * columns + c;
        if (total != null && index >= total) break;
        const video = pages.current.get(Math.floor(index / PER_PAGE))?.[
          index % PER_PAGE
        ];
        const mine = video ? (personal.current.get(video.id) ?? null) : null;
        cards.push(
          !video ? (
            <PlaceholderCard
              key={`placeholder-${index}`}
              width={cardWidth}
              height={cardHeight}
              thumbRadius={view === 'list' ? 14 : 6}
            />
          ) : view === 'list' ? (
            <VideoRow
              key={video.id}
              client={client}
              video={video}
              imageUrl={client.imageUrl(video)}
              width={cardWidth}
              personal={mine}
              onPress={pressVideo}
              onAddTag={onAddTag}
              onAddPerformer={onAddPerformer}
              onToggleFavorite={onToggleFavorite}
              onToggleLater={onToggleLater}
              index={index}
              focus={focus}
              held={held}
              onHold={onHold}
              onRelease={onRelease}
            />
          ) : (
            <VideoCard
              key={video.id}
              client={client}
              video={video}
              imageUrl={client.imageUrl(video, view === 'grid3' ? 320 : 640)}
              width={cardWidth}
              height={cardHeight}
              onPress={pressVideo}
              selected={large && drawerOpen && selected?.id === video.id}
              index={index}
              focus={focus}
              held={held}
              onHold={onHold}
              onRelease={onRelease}
              showStudio={view === 'grid2'}
              favorite={!!mine?.favorite}
              progress={mine?.progress ?? 0}
            />
          )
        );
      }
      return (
        <View
          style={[
            styles.row,
            {
              height: rowHeight,
              gap: spec.gapX,
              paddingHorizontal: spec.padX,
              paddingBottom: spec.gapY,
            },
          ]}
        >
          {cards}
        </View>
      );
    },
    // version: a page or the user's data arrived (they live in refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      columns,
      total,
      version,
      view,
      spec,
      client,
      cardWidth,
      cardHeight,
      rowHeight,
      pressVideo,
      large,
      drawerOpen,
      selected,
      focus,
      held,
      onHold,
      onRelease,
      onAddTag,
      onAddPerformer,
      onToggleFavorite,
      onToggleLater,
    ]
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
          rail={false}
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
          avatar={initialOf(client.username)}
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
        {error ? (
          <View style={styles.errorRow}>
            <ErrorText style={styles.error}>{error}</ErrorText>
            <Button label="Retry" variant="text" size="sm" onPress={retry} />
          </View>
        ) : null}
        <View style={styles.listArea}>
          {total == null && !error ? (
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
            extraData={version}
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
            refreshing={refreshing}
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
              personal={personal.current.get(selected.id) ?? null}
              onPlay={playVideo}
              onToggleFavorite={onToggleFavorite}
              onToggleLater={onToggleLater}
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

      {/* The title's Show sheet (6d) */}
      <Sheet visible={sheet === 'show'} onClose={() => setSheet(null)}>
        <SheetHeading>Show</SheetHeading>
        <SheetRow
          icon="film-strip"
          label="All videos"
          meta={videos(sheetCounts.all)}
          checked={!saved && !conditions && !searched}
          onPress={showAll}
        />
        {savedFilters.length ? (
          <SheetSection>Saved filters</SheetSection>
        ) : null}
        {savedFilters.map((f) => {
          const opens = loadSavedFilter(f).view;
          return (
            <SheetRow
              key={f.id}
              icon="bookmarks-simple"
              label={f.name}
              meta={[
                videos(sheetCounts[`saved-${f.id}`]),
                opens ? `opens in ${opens}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              checked={saved?.filter.id === f.id}
              onPress={() => {
                setSheet(null);
                loadSaved(f);
              }}
            />
          );
        })}
        <SheetSection>Quick</SheetSection>
        {BUILT_IN.map((q) => (
          <SheetRow
            key={q.key}
            icon={q.icon}
            label={q.label}
            checked={quickOn(q.make())}
            onPress={() => showQuick(q.make)}
          />
        ))}
        {conditions || searched ? (
          <>
            <SheetRule />
            <SheetRow
              icon="plus"
              label="Save as new filter…"
              meta="The filter, search and view"
              accent
              onPress={openSaveAs}
            />
          </>
        ) : null}
      </Sheet>

      {/* The avatar's account sheet (6e) */}
      <Sheet visible={sheet === 'account'} onClose={() => setSheet(null)}>
        <View style={styles.account}>
          <View style={styles.accountAvatar}>
            <Text style={styles.accountInitial}>
              {initialOf(client.username)}
            </Text>
          </View>
          <View style={styles.accountText}>
            <Text style={styles.accountName} numberOfLines={1}>
              {client.username}
            </Text>
            <View style={styles.accountServer}>
              <StatusDot on />
              <Text style={styles.accountServerText} numberOfLines={1}>
                {client.server.replace(/^https?:\/\//, '')}
              </Text>
            </View>
          </View>
        </View>
        <SheetRule />
        <SheetRow
          icon="arrow-clockwise"
          label="Refresh library"
          onPress={() => {
            setSheet(null);
            refresh();
          }}
        />
        <SheetRow
          icon="sign-out"
          label="Log out"
          onPress={() => {
            setSheet(null);
            onLogout();
          }}
        />
      </Sheet>

      {/* Save as…: a name for the new saved filter */}
      <Sheet visible={sheet === 'saveAs'} onClose={() => setSheet(null)}>
        <SheetHeading>Save as a new filter</SheetHeading>
        <Text style={styles.saveAsHint}>
          The filter, the search and the view, as a saved filter in Cove.
        </Text>
        <TextField
          value={newName}
          onChangeText={(t) => {
            setNewName(t);
            setSheetError('');
          }}
          onSubmitEditing={saveAs}
          placeholder="Name"
          autoFocus
          returnKeyType="done"
          style={styles.nameInput}
        />
        {sheetError ? (
          <ErrorText style={styles.sheetError}>{sheetError}</ErrorText>
        ) : null}
        <Button
          label="Save"
          size="lg"
          disabled={!newName.trim()}
          onPress={saveAs}
          style={styles.saveButton}
        />
      </Sheet>
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
  row: { flexDirection: 'row' },
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
  account: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  accountAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accent800,
  },
  accountInitial: {
    color: n.accent100,
    fontSize: 19,
    fontFamily: fonts.medium,
  },
  accountText: { flex: 1, minWidth: 0, gap: 2 },
  accountName: { color: n.text, fontSize: 17, fontFamily: fonts.medium },
  accountServer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accountServerText: {
    flexShrink: 1,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
  saveAsHint: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    color: n.textAlpha(55),
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  nameInput: { marginHorizontal: 20 },
  sheetError: { marginHorizontal: 20, marginTop: 8 },
  saveButton: { marginHorizontal: 20, marginTop: 16 },
});
