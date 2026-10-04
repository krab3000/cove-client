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
import { VideoCard } from '../components/VideoCard';
import WheelCapture, {
  type WheelEvent,
} from '../native/WheelCaptureNativeComponent';

const PER_PAGE = 40;
const CARD_MIN_WIDTH = 300;
const PADDING = 16;
const GAP = 14;
// Card text below the 16:9 thumbnail, for the row height.
const CARD_TEXT_HEIGHT = 64;
// One wheel notch scrolls this much of a row (React Native Windows' own step is 120 px).
const WHEEL_ROWS_PER_NOTCH = 0.75;

/** The library as an endless grid: pages of videos/find are appended as the end of the list comes into view. */
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

  const rowHeight = (cardWidth * 9) / 16 + CARD_TEXT_HEIGHT + GAP;

  const listRef = useRef<FlatList<Video>>(null);
  const [scroll, setScroll] = useState({ offset: 0, content: 0, viewport: 0 });
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;
  // Where wheel scrolling is heading: consecutive notches add up while the animation runs.
  const wheelTarget = useRef<{ offset: number; at: number } | null>(null);

  const scrollTo = useCallback((offset: number, animated: boolean) => {
    const { content, viewport } = scrollRef.current;
    const clamped = Math.min(
      Math.max(0, offset),
      Math.max(0, content - viewport)
    );
    listRef.current?.scrollToOffset({ offset: clamped, animated });
    return clamped;
  }, []);

  const onWheel = useCallback(
    (e: NativeSyntheticEvent<WheelEvent>) => {
      const now = Date.now();
      const pending = wheelTarget.current;
      const from =
        pending && now - pending.at < 400
          ? pending.offset
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

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setScroll({
      offset: contentOffset.y,
      content: contentSize.height,
      viewport: layoutMeasurement.height,
    });
  }, []);

  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  // Paging state outside React state: onEndReached can fire again before a render.
  // failed: the last load failed; only Retry loads again (onEndReached would retry in a loop).
  const paging = useRef({
    next: 1,
    done: false,
    busy: false,
    failed: false,
    generation: 0,
  });

  const loadMore = useCallback(
    async (retry = false) => {
      const p = paging.current;
      if (p.busy || p.done || (p.failed && !retry)) return;
      p.failed = false;
      p.busy = true;
      const generation = p.generation;
      setLoading(true);
      setError('');
      try {
        const page = await client.findVideos(p.next, PER_PAGE);
        if (generation !== paging.current.generation) return; // refreshed meanwhile
        p.next = page.page + 1;
        p.done =
          page.items.length === 0 ||
          page.page * page.perPage >= page.totalCount;
        setTotal(page.totalCount);
        setVideos((current) => {
          const seen = new Set(current.map((v) => v.id));
          return current.concat(page.items.filter((v) => !seen.has(v.id)));
        });
      } catch (e) {
        if (generation === paging.current.generation) {
          p.failed = true;
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (generation === paging.current.generation) {
          p.busy = false;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [client]
  );

  const refresh = useCallback(() => {
    paging.current = {
      next: 1,
      done: false,
      busy: false,
      failed: false,
      generation: paging.current.generation + 1,
    };
    setRefreshing(true);
    setVideos([]);
    setTotal(null);
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    loadMore();
  }, [loadMore]);

  const renderItem = useCallback(
    ({ item }: { item: Video }) => (
      <VideoCard
        client={client}
        video={item}
        imageUrl={client.imageUrl(item)}
        width={cardWidth}
        onPress={onPlay}
      />
    ),
    [client, cardWidth, onPlay]
  );

  return (
    <View
      style={styles.screen}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <View style={styles.header}>
        <Text style={styles.heading}>Cove</Text>
        <Text style={styles.count}>
          {total == null ? '' : `${videos.length} of ${total} videos`}
        </Text>
        <View style={styles.headerActions}>
          <Text style={styles.count}>{client.username}</Text>
          <Button title="Refresh" onPress={refresh} />
          <Button title="Log out" onPress={onLogout} />
        </View>
      </View>
      <View style={styles.listArea}>
        <FlatList
          ref={listRef}
          key={columns} // numColumns cannot change on a mounted FlatList
          data={videos}
          numColumns={columns}
          keyExtractor={(v) => String(v.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          columnWrapperStyle={columns > 1 ? styles.row : undefined}
          onEndReached={() => loadMore()}
          onScroll={onScroll}
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
          onEndReachedThreshold={1.5}
          refreshing={refreshing}
          onRefresh={refresh}
          initialNumToRender={PER_PAGE / 2}
          windowSize={7}
          ListFooterComponent={
            <View style={styles.footer}>
              {loading ? <ActivityIndicator color={colors.accent} /> : null}
              {error ? (
                <View style={styles.errorRow}>
                  <Text style={styles.error}>{error}</Text>
                  <Button title="Retry" onPress={() => loadMore(true)} />
                </View>
              ) : null}
              {!loading &&
              !error &&
              paging.current.done &&
              videos.length > 0 ? (
                <Text style={styles.count}>That's everything.</Text>
              ) : null}
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  listArea: { flex: 1 },
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
  content: { padding: PADDING, gap: GAP },
  row: { gap: GAP },
  footer: { paddingVertical: 24, alignItems: 'center', gap: 10 },
  errorRow: { alignItems: 'center', gap: 10 },
  error: { color: colors.error },
});
