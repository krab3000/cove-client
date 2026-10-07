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
  Animated,
  Easing,
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRowVideos, type VideoPages } from '../../../data/videoPages';
import { holdStaged } from '../../../utils/staged';
import WheelCapture, {
  type WheelEvent,
} from '../../../native/WheelCaptureNativeComponent';
import type { LibraryView } from './LibraryHeader';
import { LibraryCard, PlaceholderCard, type CardActions } from './LibraryCard';

export type GridHandle = {
  scrollToOffset: (params: { offset: number; animated: boolean }) => void;
};

// How long cards take to move to a new layout
const MOVE_MS = 450;
// A card new to the screen comes in where it lands: from transparent, this much smaller and this much lower; the
// further down the screen, the later it starts (up to this share of the move).
const ENTER_SCALE = 0.85;
const ENTER_RISE = 24;
const ENTER_STAGGER = 0.4;
// RNW's native animated driver is incomplete; there the JS one runs (desktops keep up)
const NATIVE_DRIVER = Platform.OS !== 'windows';

type Layout = {
  columns: number;
  rowHeight: number;
  cardWidth: number;
  cardHeight: number;
  padX: number;
  gapX: number;
};

// A move from one layout to another: the cards that were in view go from where they were to their new places, the
// others fade in where they are.
type Move = {
  progress: Animated.Value;
  from: Layout;
  fromY: number;
  // The old layout's content height: the content stays at least as tall during the move, so the scroll view can
  // take the new position at once (in a shorter content it stopped at the end, and got there frames later)
  fromHeight: number;
  toY: number;
  // The cards that were in view (indices), kept rendered until the move ends, even those it takes out of view
  start: number;
  end: number;
};

/**
 * The Library's grid, in all three views: one scrolling area as tall as the whole list, its cards placed by their
 * index (rows have a fixed height, so every card's place is known without rendering the others). Only the cards a
 * screen above, in and below the view are rendered.
 *
 * Cards are keyed by video, not by row. So when the view changes (2 columns, 3 columns, the list), the cards that
 * stay on screen are moved and resized rather than made again: making a few dozen cards' native views in one go took
 * the UI thread a few hundred milliseconds on slow devices. And the same video stays at the top: the grid follows
 * the first card in view by its index, not by the scroll position. The move is animated (transforms only, on the
 * native driver: no layout per frame).
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
  // The scroll position: here for the layout a move starts from, and as an animated value for the cards during one,
  // set from the scroll events (should the scroll view take the new layout's position late, see pendingY, the cards
  // still move from where they were).
  const scrollY = useRef(0);
  const scrollValue = useRef(new Animated.Value(0)).current;

  const rowCount = Math.ceil(total / columns);
  const contentHeight = top + rowCount * rowHeight;
  const screenRows = Math.max(1, Math.ceil(viewport / rowHeight)) + 1;

  const layout: Layout = {
    columns,
    rowHeight,
    cardWidth,
    cardHeight,
    padX,
    gapX,
  };
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });

  // Another layout (the view, the window's width): the same video stays at the top, or as near as the new layout
  // scrolls (the end of the list). Set during render, so this render already shows the cards around it.
  const layoutKey = `${columns}:${rowHeight}:${cardWidth}`;
  const [renderedLayout, setRenderedLayout] = useState(layoutKey);
  const [move, setMove] = useState<Move | null>(null);
  // The move whose animation runs. It starts a couple of frames after the move's first render: that one draws the
  // cards at their old places with plain values (with the new layout, in one mount); had it drawn them with animated
  // values, the native driver could apply those to views that still had the old layout for a frame or two (cards
  // drawn twice too large or too small).
  const [running, setRunning] = useState<Move | null>(null);
  const moving = useRef(false);
  moving.current = move != null;
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
    if (viewport > 0) {
      const from = layoutRef.current;
      const fromY = scrollY.current;
      const startRow = Math.max(0, Math.floor((fromY - top) / from.rowHeight));
      const endRow = Math.floor((fromY + viewport - top) / from.rowHeight);
      scrollValue.setValue(row * rowHeight);
      setMove({
        progress: new Animated.Value(0),
        from,
        fromY,
        fromHeight: top + Math.ceil(total / from.columns) * from.rowHeight,
        toY: row * rowHeight,
        start: startRow * from.columns,
        end: Math.min(total, (endRow + 1) * from.columns),
      });
    } else setMove(null);
  }
  useEffect(() => {
    if (!move) return;
    holdStaged(MOVE_MS + 100);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setRunning(move));
    });
    return () => cancelAnimationFrame(frame);
  }, [move]);
  useLayoutEffect(() => {
    if (!move || running !== move) return;
    holdStaged(MOVE_MS);
    const animation = Animated.timing(move.progress, {
      toValue: 1,
      duration: MOVE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: NATIVE_DRIVER,
    });
    animation.start(() => setMove((m) => (m === move ? null : m)));
    return () => animation.stop();
  }, [move, running]);
  // The buffer grows once the cards are in place
  useEffect(() => {
    if (move || buffer >= screenRows) return;
    const frame = requestAnimationFrame(() =>
      setBuffer((b) => Math.min(screenRows, b + 1))
    );
    return () => cancelAnimationFrame(frame);
  }, [move, buffer, screenRows]);
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
  let start = startRow * columns;
  let end = Math.min(total, (endRow + 1) * columns);
  if (move) {
    start = Math.min(start, move.start);
    end = Math.min(total, Math.max(end, move.end));
  }
  const videos = useRowVideos(pages, start, Math.max(0, end - start));

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      scrollY.current = y;
      if (moving.current) scrollValue.setValue(y);
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
    [top, rowHeight, columns, screenRows, onScroll, scrollValue]
  );

  // Where a card is drawn during a move: from its place in the old layout (on screen) to its place in this one.
  // Transforms scale around the card's center, so the translation makes up for that.
  const moveStyle = (index: number) => {
    if (!move) return null;
    const { progress, from, fromY, toY } = move;
    const animate = running === move;
    const x = padX + (index % columns) * (cardWidth + gapX);
    const y = top + Math.floor(index / columns) * rowHeight;
    const at = (a: number, b: number) =>
      animate
        ? progress.interpolate({
            inputRange: [0, 1],
            outputRange: [a, b],
          })
        : a;
    // The scroll view is where it is; the card is drawn as if it were at the new layout's position already
    const follow = (a: number, b: number) =>
      animate ? Animated.add(scrollValue, at(a, b)) : toY + a;
    if (index < move.start || index >= move.end) {
      const onScreen =
        (y - toY + (index % columns) * cardHeight * 0.25) / viewport;
      const delay = Math.min(1, Math.max(0, onScreen)) * ENTER_STAGGER;
      const enter = (a: number, b: number) =>
        animate
          ? progress.interpolate({
              inputRange: [delay, 1],
              outputRange: [a, b],
              extrapolate: 'clamp',
            })
          : a;
      return {
        opacity: enter(0, 1),
        transform: [
          {
            translateY: animate
              ? Animated.add(scrollValue, enter(ENTER_RISE - toY, -toY))
              : ENTER_RISE,
          },
          { scale: enter(ENTER_SCALE, 1) },
        ],
      };
    }
    const scale = from.cardWidth / cardWidth;
    const oldX =
      from.padX + (index % from.columns) * (from.cardWidth + from.gapX);
    const oldY =
      top + Math.floor(index / from.columns) * from.rowHeight - fromY;
    return {
      transform: [
        {
          translateX: at(oldX - x - (cardWidth * (1 - scale)) / 2, 0),
        },
        {
          translateY: follow(oldY - y - (cardHeight * (1 - scale)) / 2, -toY),
        },
        {
          scale: at(scale, 1),
        },
      ],
    };
  };

  const list = view === 'list';
  const content = (
    <View
      style={{
        height: move ? Math.max(contentHeight, move.fromHeight) : contentHeight,
      }}
    >
      {videos.map((video, i) => {
        const index = start + i;
        const style = [
          {
            position: 'absolute' as const,
            left: padX + (index % columns) * (cardWidth + gapX),
            top: top + Math.floor(index / columns) * rowHeight,
          },
          moveStyle(index),
        ];
        // collapsable: the wrapper has only layout props most of the time, so Fabric would flatten it away, and make it a
        // view again for a move's transform: moving the card's views out of the content and back in each time (their
        // images came back blank, some of them).
        return video ? (
          <Animated.View key={`v${video.id}`} style={style} collapsable={false}>
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
          </Animated.View>
        ) : (
          <Animated.View key={`p${index}`} style={style} collapsable={false}>
            <PlaceholderCard
              width={cardWidth}
              height={cardHeight}
              list={list}
            />
          </Animated.View>
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
        setMove(null);
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
