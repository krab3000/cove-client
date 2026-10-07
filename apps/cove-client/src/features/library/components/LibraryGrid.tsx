import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type Ref,
} from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRowVideos, type VideoPages } from '../../../data/videoPages';
import WheelCapture, {
  type WheelEvent,
} from '../../../native/WheelCaptureNativeComponent';
import type { LibraryView } from './LibraryHeader';
import { LibraryCard, PlaceholderCard, type CardActions } from './LibraryCard';

export type GridHandle = {
  scrollToOffset: (params: { offset: number; animated: boolean }) => void;
};

/**
 * The Library's grid, in all three views: one scrolling area as tall as the whole list, its cards placed by their
 * index (rows have a fixed height, so every card's place is known without rendering the others). Only the cards a
 * screen above, in and below the view are rendered.
 *
 * Cards are keyed by video, not by row. So when the view changes (2 columns, 3 columns, the list), the cards that
 * stay on screen are moved and resized rather than made again: making a few dozen cards' native views in one go took
 * the UI thread a few hundred milliseconds on slow devices. And the same video stays at the top: the grid follows
 * the first card in view by its index, not by the scroll position.
 */
export function LibraryGrid({
  ref,
  top,
  total,
  pages,
  view,
  columns,
  cardWidth,
  cardHeight,
  rowHeight,
  padX,
  gapX,
  cards,
  onScroll,
  onScrollBeginDrag,
  onScrollEndDrag,
  onLayout,
  onContentSizeChange,
  showsVerticalScrollIndicator,
  refreshing,
  onRefresh,
  onWheel,
}: {
  ref?: Ref<GridHandle>;
  // Space above the first row
  top: number;
  total: number;
  pages: VideoPages;
  view: LibraryView;
  columns: number;
  cardWidth: number;
  cardHeight: number;
  // A row's height with the gap under it
  rowHeight: number;
  padX: number;
  gapX: number;
  cards: CardActions;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
  showsVerticalScrollIndicator: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  // Windows: the mouse wheel over the cards (see WheelCapture)
  onWheel?: (e: NativeSyntheticEvent<WheelEvent>) => void;
}) {
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useImperativeHandle(
    ref,
    () => ({
      scrollToOffset: ({ offset, animated }) =>
        scrollRef.current?.scrollTo({ y: offset, animated }),
    }),
    []
  );

  const [viewport, setViewport] = useState(0);
  // The first card in view (its row's first), exactly; and the one the rendered cards are placed around, which
  // follows it only every half screen of scrolling (each change re-renders the grid).
  const anchor = useRef(0);
  const [first, setFirst] = useState(0);
  const firstRef = useRef(first);
  firstRef.current = first;
  // Rows rendered above and below those in view: none right after a new layout, then one more each way per frame
  // up to a screen (each new card's native views are made on the UI thread; a few dozen at once kept it, and
  // touches, waiting).
  const [buffer, setBuffer] = useState(0);

  const rowCount = Math.ceil(total / columns);
  const contentHeight = top + rowCount * rowHeight;
  const screenRows = Math.max(1, Math.ceil(viewport / rowHeight)) + 1;

  // Another layout (the view, the window's width): the same video stays at the top, or as near as the new layout
  // scrolls (the end of the list). Set during render, so this render already shows the cards around it.
  const layoutKey = `${columns}:${rowHeight}`;
  const [renderedLayout, setRenderedLayout] = useState(layoutKey);
  // Where the new layout scrolls to, until a scroll event says the scroll view is there
  const pendingY = useRef<number | null>(null);
  if (renderedLayout !== layoutKey) {
    const lastRow = Math.max(
      0,
      Math.floor((contentHeight - viewport) / rowHeight)
    );
    const row = Math.min(Math.floor(anchor.current / columns), lastRow);
    pendingY.current = row * rowHeight;
    setRenderedLayout(layoutKey);
    setFirst(row * columns);
    setBuffer(0);
  }
  useEffect(() => {
    if (buffer >= screenRows) return;
    const frame = requestAnimationFrame(() =>
      setBuffer((b) => Math.min(screenRows, b + 1))
    );
    return () => cancelAnimationFrame(frame);
  }, [buffer, screenRows]);
  // Sent again each frame until a scroll event says it got there: the layout here is computed ahead of the native
  // views, so the first sends can reach a scroll view whose content still has the old height, and stop at its end.
  useLayoutEffect(() => {
    let tries = 0;
    let frame = 0;
    const send = () => {
      const y = pendingY.current;
      if (y == null) return;
      if (tries++ > 20) {
        pendingY.current = null;
        return;
      }
      scrollRef.current?.scrollTo({ y, animated: false });
      frame = requestAnimationFrame(send);
    };
    send();
    return () => cancelAnimationFrame(frame);
  }, [renderedLayout]);

  const firstRow = Math.floor(first / columns);
  const startRow = Math.max(0, firstRow - buffer);
  const endRow = Math.min(rowCount - 1, firstRow + screenRows - 1 + buffer);
  const start = startRow * columns;
  const end = Math.min(total, (endRow + 1) * columns);
  const videos = useRowVideos(pages, start, Math.max(0, end - start));

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      if (pendingY.current != null && Math.abs(y - pendingY.current) < 2)
        pendingY.current = null;
      const row = Math.max(
        0,
        Math.floor((y - top + rowHeight / 2) / rowHeight)
      );
      anchor.current = row * columns;
      // The rendered cards follow every half screen (they reach a screen past the view)
      if (
        Math.abs(row - Math.floor(firstRef.current / columns)) >=
        Math.max(1, Math.floor(screenRows / 2))
      )
        setFirst(row * columns);
      onScroll(e);
    },
    [top, rowHeight, columns, screenRows, onScroll]
  );

  const list = view === 'list';
  const content = (
    <View style={{ height: top + rowCount * rowHeight }}>
      {videos.map((video, i) => {
        const index = start + i;
        const style = {
          position: 'absolute' as const,
          left: padX + (index % columns) * (cardWidth + gapX),
          top: top + Math.floor(index / columns) * rowHeight,
        };
        return video ? (
          <View key={`v${video.id}`} style={style}>
            <LibraryCard
              client={cards.client}
              onPress={cards.onPress}
              onAddTag={cards.onAddTag}
              onAddPerformer={cards.onAddPerformer}
              focus={cards.focus}
              held={cards.held}
              onHold={cards.onHold}
              onRelease={cards.onRelease}
              selected={cards.selectedId === video.id}
              video={video}
              view={view}
              index={index}
              width={cardWidth}
              height={cardHeight}
            />
          </View>
        ) : (
          <View key={`p${index}`} style={style}>
            <PlaceholderCard
              width={cardWidth}
              height={cardHeight}
              list={list}
            />
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={handleScroll}
      onScrollBeginDrag={() => {
        pendingY.current = null; // the user scrolls now
        onScrollBeginDrag();
      }}
      onScrollEndDrag={onScrollEndDrag}
      scrollEventThrottle={16}
      onLayout={(e) => {
        setViewport(e.nativeEvent.layout.height);
        onLayout(e);
      }}
      onContentSizeChange={onContentSizeChange}
      // RNW's native scrollbar hides itself for good once the content fits the viewport (as it does before the
      // first page arrives): only a change of this prop makes it check again. So it flips with the overflow.
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {Platform.OS === 'windows' && onWheel ? (
        <WheelCapture onWheel={onWheel}>{content}</WheelCapture>
      ) : (
        content
      )}
    </ScrollView>
  );
}
