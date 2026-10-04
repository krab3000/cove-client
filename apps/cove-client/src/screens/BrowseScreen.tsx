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
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { CoveClient } from '../api/cove';
import type { Video } from '../api/types';
import { Button, colors } from '../components/Controls';
import {
  CARD_TEXT_HEIGHT,
  PlaceholderCard,
  VideoCard,
} from '../components/VideoCard';
import WheelCapture, {
  type WheelEvent,
} from '../native/WheelCaptureNativeComponent';

const PER_PAGE = 40;
const CARD_MIN_WIDTH = 300;
const PADDING = 16;
const GAP = 14;
// One wheel notch scrolls this much of a row (React Native Windows' own step is 120 px).
const WHEEL_ROWS_PER_NOTCH = 0.75;
// Pages load once scrolling rests this long (dragging the scrollbar across the library loads nothing on the way).
const LOAD_DELAY_MS = 120;
// Also load this many screens above and below the visible rows.
const PREFETCH_SCREENS = 1;

/**
 * The whole library as one grid, virtual in both senses: the list is as long as the library from the first page on
 * (videos/find reports the total), so the scrollbar shows the real size and position, and it can jump anywhere.
 * Rows have a fixed height, so their offsets are known without rendering them. Pages of videos/find load for the
 * rows in view (and a screen around them); rows whose page has not arrived show placeholders. FlatList renders
 * only the rows near the viewport.
 */
export function BrowseScreen({
  client,
  onPlay,
  onLogout,
}: {
  client: CoveClient;
  onPlay: (video: Video) => void;
  onLogout: () => void;
}) {
  // Measured, not useWindowDimensions: that one does not follow window resizes on Windows.
  const [width, setWidth] = useState(1000);
  const columns = Math.max(
    1,
    Math.floor((width - 2 * PADDING + GAP) / (CARD_MIN_WIDTH + GAP))
  );
  const cardWidth = Math.floor(
    (width - 2 * PADDING - GAP * (columns - 1)) / columns
  );
  // The card's 16:9 thumbnail sits inside its 1 px border.
  const cardHeight = Math.round(((cardWidth - 2) * 9) / 16) + CARD_TEXT_HEIGHT;
  const rowHeight = cardHeight + GAP;

  // --- Pages ---------------------------------------------------------------------------------------------------
  // Loaded pages (0-based) of PER_PAGE videos. Kept in refs; `version` re-renders when one arrives.
  const pages = useRef(new Map<number, Video[]>());
  const pending = useRef(new Set<number>());
  const failed = useRef(new Set<number>());
  const generation = useRef(0);
  const [version, setVersion] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadPage = useCallback(
    async (page: number) => {
      if (pages.current.has(page) || pending.current.has(page)) return;
      const gen = generation.current;
      pending.current.add(page);
      failed.current.delete(page);
      try {
        const result = await client.findVideos(page + 1, PER_PAGE);
        if (gen !== generation.current) return; // refreshed meanwhile
        pages.current.set(page, result.items);
        setTotal(result.totalCount);
        setError('');
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
    [client]
  );

  const rowCount = total == null ? 0 : Math.ceil(total / columns);
  const rows = useMemo(
    () => Array.from({ length: rowCount }, (_, i) => i),
    [rowCount]
  );

  // --- Scrolling -----------------------------------------------------------------------------------------------
  const listRef = useRef<FlatList<number>>(null);
  const [scroll, setScroll] = useState({ offset: 0, content: 0, viewport: 0 });
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;
  // The first video in view, to keep it in view when the grid reflows (window resize, rotation).
  const anchor = useRef(0);
  const layout = useRef({ columns, rowHeight });
  layout.current = { columns, rowHeight };

  // Loads the pages for the rows in view and a screen around them.
  const loadVisible = useCallback(() => {
    if (total == null) return;
    const { offset, viewport } = scrollRef.current;
    const { columns: cols, rowHeight: rh } = layout.current;
    const margin = viewport * PREFETCH_SCREENS;
    const firstRow = Math.max(0, Math.floor((offset - PADDING - margin) / rh));
    const lastRow = Math.floor((offset + viewport + margin - PADDING) / rh);
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
        Math.max(0, Math.floor((contentOffset.y - PADDING + rh / 2) / rh)) *
        cols;
      scheduleLoad();
    },
    [scheduleLoad]
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
    pending.current = new Set();
    failed.current = new Set();
    setRefreshing(true);
    setError('');
    setTotal(null);
    setVersion((v) => v + 1);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    loadPage(0);
  }, [loadPage]);

  const retry = useCallback(() => {
    failed.current = new Set();
    setError('');
    if (total == null) loadPage(0);
    else loadVisible();
  }, [total, loadPage, loadVisible]);

  // --- Touch preview -------------------------------------------------------------------------------------------
  // Press and hold a card. It lasts while the finger is down, also when the finger goes on to scroll the list: the
  // content moves with the finger, so the card stays under it. The card's press ends when the list takes the
  // touch over, so then only the end of the drag (finger up) stops the preview.
  const [heldId, setHeldId] = useState<number | null>(null);
  const dragging = useRef(false);
  const onHold = useCallback((video: Video) => setHeldId(video.id), []);
  const onRelease = useCallback((video: Video) => {
    // The scroll drag, if this press turned into one, starts right after the press ends.
    setTimeout(() => {
      if (!dragging.current) setHeldId((id) => (id === video.id ? null : id));
    }, 80);
  }, []);

  const renderRow = useCallback(
    ({ item: row }: { item: number }) => {
      const cards: ReactNode[] = [];
      for (let c = 0; c < columns; c++) {
        const index = row * columns + c;
        if (total != null && index >= total) break;
        const video = pages.current.get(Math.floor(index / PER_PAGE))?.[
          index % PER_PAGE
        ];
        cards.push(
          video ? (
            <VideoCard
              key={video.id}
              client={client}
              video={video}
              imageUrl={client.imageUrl(video)}
              width={cardWidth}
              height={cardHeight}
              onPress={onPlay}
              held={video.id === heldId}
              onHold={onHold}
              onRelease={onRelease}
            />
          ) : (
            <PlaceholderCard
              key={`placeholder-${index}`}
              width={cardWidth}
              height={cardHeight}
            />
          )
        );
      }
      return <View style={[styles.row, { height: rowHeight }]}>{cards}</View>;
    },
    // version: a page arrived (the pages live in a ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      columns,
      total,
      version,
      client,
      cardWidth,
      cardHeight,
      rowHeight,
      onPlay,
      heldId,
      onHold,
      onRelease,
    ]
  );

  const getItemLayout = useCallback(
    (_: ArrayLike<number> | null | undefined, index: number) => ({
      length: rowHeight,
      offset: PADDING + rowHeight * index,
      index,
    }),
    [rowHeight]
  );

  return (
    <View
      style={styles.screen}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <View style={styles.header}>
        <Text style={styles.heading}>Cove</Text>
        <Text style={styles.count}>
          {total == null ? '' : `${total} videos`}
        </Text>
        {error ? (
          <View style={styles.errorRow}>
            <Text style={styles.error} numberOfLines={1}>
              {error}
            </Text>
            <Button title="Retry" onPress={retry} />
          </View>
        ) : null}
        <View style={styles.headerActions}>
          <Text style={styles.count}>{client.username}</Text>
          <Button title="Refresh" onPress={refresh} />
          <Button title="Log out" onPress={onLogout} />
        </View>
      </View>
      <View style={styles.listArea}>
        {total == null && !error ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
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
            setHeldId(null); // finger up
          }}
          // RNW's native scrollbar hides itself for good once the content fits the viewport (as it does before
          // the first page arrives): only a change of this prop makes it check again. So it flips with the overflow.
          showsVerticalScrollIndicator={scroll.content > scroll.viewport}
          scrollEventThrottle={16}
          onContentSizeChange={(_, h) =>
            setScroll((s) => ({ ...s, content: h }))
          }
          onLayout={(e) => {
            // Read now: the event is released once the handler returns, before the updater runs.
            const viewport = e.nativeEvent.layout.height;
            setScroll((s) => ({ ...s, viewport }));
          }}
          CellRendererComponent={Platform.OS === 'windows' ? Cell : undefined}
          refreshing={refreshing}
          onRefresh={refresh}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={5}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  listArea: { flex: 1 },
  center: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: PADDING,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heading: { color: colors.text, fontSize: 22, fontWeight: '600' },
  count: { color: colors.textDim },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 'auto',
  },
  // Rows carry the gap below them (part of their fixed height); the list's bottom padding makes up the rest.
  content: { paddingTop: PADDING, paddingBottom: PADDING - GAP },
  row: {
    flexDirection: 'row',
    gap: GAP,
    paddingHorizontal: PADDING,
    paddingBottom: GAP,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  error: { color: colors.error, flexShrink: 1 },
});
