import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
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
import {
  LibraryHeader,
  type FilterChip,
  type FilterPreset,
  type LibraryView,
} from '../components/LibraryHeader';
import {
  GROUP_LABELS,
  appendTo,
  conditionCount,
  describeCondition,
  emptyTree,
  fieldById,
  newId,
  removeNode,
  toWire,
  type Condition,
  type Group,
  type Node,
} from '../filter/model';
import {
  loadSavedFilter,
  savedFilterChange,
  type LoadedFilter,
} from '../filter/saved';
import { fonts, nocturne as n } from '../filter/theme';
import { FilterScreen } from './FilterScreen';
import {
  createSelection,
  NO_RANGE,
  type IndexRange,
} from '../components/selection';
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

// Negative conditions show as struck-through chips (without their "not").
const NEGATIVE = [
  'excludes',
  'excludesAll',
  'notEquals',
  'notBetween',
  'notMatchesRegex',
  'notUnderPath',
];

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

function chipOf(node: Node): FilterChip {
  if (node.kind === 'group')
    return {
      id: node.id,
      label: `${GROUP_LABELS[node.op].toLowerCase()} ${conditionCount(node)}`,
      kind: 'group',
    };
  const negative =
    NEGATIVE.includes(node.modifier) ||
    (fieldById(node.field).type === 'bool' && node.value === false);
  const label = describeCondition(node);
  return negative
    ? { id: node.id, label: label.replace(/^not /, ''), kind: 'ex' }
    : { id: node.id, label, kind: 'in' };
}

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${Math.round(bytes / 1e9)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

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
  onPlay: (video: Video) => void;
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
  // The saved filter loaded, if any, and whether the filter changed since.
  const [saved, setSaved] = useState<{
    filter: SavedFilter;
    loaded: LoadedFilter;
    edited: boolean;
  } | null>(null);
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
  const spec = VIEWS[view];
  const columns = Math.max(
    spec.min,
    Math.floor((width - 2 * spec.padX + spec.gapX) / (spec.target + spec.gapX))
  );
  const cardWidth = Math.floor(
    (width - 2 * spec.padX - spec.gapX * (columns - 1)) / columns
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
          seedRef.current
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

  // The count line: count, total duration and size of what the filter matches.
  useEffect(() => {
    let alive = true;
    setAggregate(null);
    client.aggregateVideos(applied).then(
      (a) => alive && setAggregate(a),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [client, applied]);

  // The user's saved filters (the filter bar offers them while there is no filter).
  useEffect(() => {
    client.savedFilters().then(setSavedFilters, () => {});
  }, [client]);

  /** Shows a changed tree: its chips, its results; a loaded saved filter is now Edited. */
  const commit = useCallback(
    (tree: Group) => {
      setFilterTree(tree);
      setAppliedTree(tree);
      if (!tree.children.length) setSaved(null);
      else setSaved((s) => (s ? { ...s, edited: true } : s));
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
      setSaved({ filter, loaded, edited: false });
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

  const save = useCallback(async () => {
    if (!saved) return;
    try {
      const updated = await client.updateSavedFilter(
        saved.filter.id,
        savedFilterChange(
          saved.filter,
          appliedTree,
          view === 'list' ? 'list' : 'grid'
        )
      );
      setSavedFilters((list) =>
        list.map((f) => (f.id === updated.id ? updated : f))
      );
      setSaved({
        filter: updated,
        loaded: loadSavedFilter(updated),
        edited: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, saved, appliedTree, view]);

  // The filter screen's Show / Play: the tree being edited becomes the one shown.
  const showFilter = useCallback(
    (filter: FilterExpression | null) => {
      const tree = filterTreeRef.current;
      setAppliedTree(tree);
      if (!filter) setSaved(null);
      else setSaved((s) => (s ? { ...s, edited: true } : s));
      applyFilter(filter);
      setFilterOpen(false);
    },
    [applyFilter]
  );
  const playFirst = useCallback(
    (filter: FilterExpression | null) => {
      client.findVideos(1, 1, filter, seedRef.current).then(
        (result) => {
          if (result.items[0]) onPlay(result.items[0]);
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
  }, [appliedTree]);
  const closeFilter = useCallback(() => setFilterOpen(false), []);

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

  // --- The header's filter bar ---------------------------------------------------------------------------------
  const chips = useMemo(() => {
    const list = appliedTree.children.map(chipOf);
    // Parts of a saved filter the app can't show still apply; they are listed as one chip until the filter changes.
    if (saved && !saved.edited && saved.loaded.dropped)
      list.push({
        id: 'more',
        label: `+ ${saved.loaded.dropped} more`,
        kind: 'more',
      });
    return list;
  }, [appliedTree, saved]);
  const presets = useMemo<FilterPreset[]>(
    () => [
      ...savedFilters.map((f) => ({
        key: `saved-${f.id}`,
        label: f.name,
        icon: 'bookmarks-simple' as const,
        saved: true,
        onPress: () => loadSaved(f),
      })),
      ...BUILT_IN.map((b) => ({
        key: b.key,
        label: b.label,
        icon: b.icon,
        saved: false,
        onPress: () => {
          setSaved(null);
          commit({ ...emptyTree(), children: [b.make()] });
        },
      })),
    ],
    [savedFilters, loadSaved, commit]
  );
  const removeChip = useCallback(
    (id: string) => commit(removeNode(appliedTree, id)),
    [appliedTree, commit]
  );
  const clear = useCallback(() => {
    setSaved(null);
    commit(emptyTree());
  }, [commit]);
  // Changed since loaded, and not back to what was saved (adding a chip and removing it again is no edit).
  const edited =
    !!saved?.edited &&
    JSON.stringify(applied) !== JSON.stringify(saved.loaded.wire);
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
              onPress={onPlay}
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
              onPress={onPlay}
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
      onPlay,
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

  return (
    <View
      style={styles.screen}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <LibraryHeader
        title={saved ? saved.filter.name : 'Videos'}
        saved={!!saved}
        edited={edited}
        // A saved filter with parts the app can't show isn't saved from here: they would be lost.
        onSave={saved && !saved.loaded.dropped ? save : undefined}
        countLine={countLine}
        chips={chips}
        presets={presets}
        onOpenFilter={openFilter}
        onOpenChip={openFilter}
        onRemoveChip={removeChip}
        onClear={clear}
        shuffled={seed != null}
        onShuffle={shuffle}
        onPlayAll={() => playFirst(applied)}
        view={view}
        onView={setView}
        username={client.username}
        onRefresh={refresh}
        onLogout={onLogout}
      />
      {error ? (
        <View style={styles.errorRow}>
          <Text style={styles.error} numberOfLines={2}>
            {error}
          </Text>
          <Pressable onPress={retry} hitSlop={8}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.listArea}>
        {total == null && !error ? (
          <View style={styles.center}>
            <ActivityIndicator color={n.accent} />
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
      {filterOpen ? (
        <FilterScreen
          client={client}
          tree={filterTree}
          onChange={setFilterTree}
          applied={applied}
          onApply={showFilter}
          onPlayAll={playFilter}
          onClose={closeFilter}
          title={saved?.filter.name}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: n.bg },
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
  error: {
    color: '#ff8a8a',
    flex: 1,
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
  retry: { color: n.accent300, fontSize: 13, fontFamily: fonts.medium },
});
