import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactElement,
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
import { LibraryCard, type CardActions } from './LibraryCard';

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
// The scroll view keeping the cards where they are on screen (see Move); Android only (elsewhere the move's end
// scrolls, which may show a frame from the wrong place)
const FOLLOW = { minIndexForVisible: 0 };
const CAN_FOLLOW = Platform.OS === 'android';
// Android draws a scroll a frame late: View.scrollTo asks for the next frame only (postInvalidateOnAnimation), while
// the cards moved in that mount are drawn in this one, under the scroll view's old position (a blank frame in the
// middle of the list). A prop change on the scroll view in the same mount redraws it in this frame too: its
// background, between transparent and an invisible black.
const REDRAW = { backgroundColor: '#00000001' };
// A parked card (see Pool): out of the way and not drawn
const PARKED = {
  position: 'absolute' as const,
  left: 0,
  top: -100000,
  opacity: 0,
};

// The grid's cards. Each slot is a card, mounted for good: it shows the card at an index (the slot's), or, its index
// out of the rendered range, it is parked, with the element it last rendered (so React skips it). An index that comes
// into the range takes the slot that showed it last, else a parked one (the one whose index is furthest away), else
// a new slot. So scrolling gives the cards that went out of the range other videos (React updates their props and
// texts, the native views stay: making new ones was most of a new card's cost), a page that arrives fills its
// skeletons in place, and a view switch keeps the cards on screen (an index is the same video in every view).
type Pool = { slots: (number | null)[]; cards: (ReactElement | null)[] };

type Layout = {
  columns: number;
  rowHeight: number;
  cardWidth: number;
  cardHeight: number;
  padX: number;
  gapX: number;
};

// A move from one layout to another (a view switch): the cards that were in view go from where they were to their new
// places, the others fade in where they are.
//
// The new layout has the same video at the top, at another scroll position (toY). But a scroll lands a frame or more
// after the layout it goes with (even one driven on the UI thread): that frame showed the cards from the wrong place,
// a blank screen in the middle of the list. So the scroll view stays where it is (fromY) during the move, and the
// cards are laid out `shift` (fromY - toY) lower. Once the animation is over, the shift is taken away with the scroll
// view keeping the cards where they are on screen: maintainVisibleContentPosition, which scrolls by as much as the
// cards moved in the same mount, on the UI thread. It is on for that mount only: turned on a mount before (it looks
// at the cards before a mount, and only from the next one on) and off a mount after; then the move goes, and the
// cards it took out of view are parked (with it on, a parked card could make it scroll away).
type Move = {
  progress: Animated.Value;
  from: Layout;
  // Where the old layout was seen from
  fromY: number;
  // The old layout's content height: the content stays at least as tall during the move (the scroll view stays where
  // it was, and its content under it)
  fromHeight: number;
  toY: number;
  shift: number;
  // The cards that were in view (indices), kept rendered until the move ends, even those it takes out of view
  start: number;
  end: number;
};

/**
 * The Library's grid, in all three views: one scrolling area as tall as the whole list, its cards placed by their
 * index (rows have a fixed height, so every card's place is known without rendering the others). Only the cards a
 * screen above, in and below the view are rendered, and the cards are reused (see Pool): making a card's native views
 * took the UI thread long on slow devices, and a few dozen at once (a view switch, a fling) a few hundred
 * milliseconds.
 *
 * When the view changes (2 columns, 3 columns, the list), the cards that stay on screen are moved and resized. And
 * the same video stays at the top: the grid follows the first card in view by its index, not by the scroll position.
 * The move is animated (transforms only, on the native driver: no layout per frame).
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
  onSettled,
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
  // A view switch's move is over (and after a layout change without one)
  onSettled?: () => void;
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
  // The scroll view's position, from its events
  const scrollY = useRef(0);
  const pool = useRef<Pool>({ slots: [], cards: [] });

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
  // Only a view switch is animated: a new width (the window's, measured once at start, a rotation) just takes the new
  // places.
  const [renderedView, setRenderedView] = useState(view);
  const [move, setMove] = useState<Move | null>(null);
  // The move whose animation runs. It starts a couple of frames after the move's first render: that one draws the
  // cards at their old places with plain values (with the new layout, in one mount); had it drawn them with animated
  // values, the native driver could apply those to views that still had the old layout for a frame or two (cards
  // drawn twice too large or too small).
  const [running, setRunning] = useState<Move | null>(null);
  // The move's end, a step a mount (see Move): 1 the cards' animated styles give way to the same static ones (the
  // native driver lets go of them a frame later: with the shift going in that mount too, a frame showed the cards
  // where they were not) and the scroll view follows the cards, 2 the shift is gone, 3 it follows no more; then the
  // move goes.
  const [ending, setEnding] = useState<{
    move: Move;
    step: number;
  } | null>(null);
  const endStep = move && ending?.move === move ? ending.step : 0;
  // Where the scroll view goes, sent each frame until a scroll event says it is there: a scroll sent with a new layout
  // can reach the scroll view before its content has grown, and stop at its end.
  const pendingY = useRef<number | null>(null);
  const [scrollSeq, setScrollSeq] = useState(0);
  const scrollTo = (y: number) => {
    pendingY.current = y;
    setScrollSeq((n) => n + 1);
  };
  if (renderedLayout !== layoutKey) {
    const lastRow = Math.max(
      0,
      Math.floor((contentHeight - viewport) / rowHeight)
    );
    const row = Math.min(Math.floor(anchor.current / columns), lastRow);
    const toY = row * rowHeight;
    setRenderedLayout(layoutKey);
    setRenderedView(view);
    setFirst(row * columns);
    setBuffer(0);
    if (viewport > 0 && view !== renderedView) {
      const from = layoutRef.current;
      const fromY = scrollY.current;
      const startRow = Math.max(0, Math.floor((fromY - top) / from.rowHeight));
      const endRow = Math.floor((fromY + viewport - top) / from.rowHeight);
      pendingY.current = null;
      setMove({
        progress: new Animated.Value(0),
        from,
        fromY,
        fromHeight: Math.max(
          move?.fromHeight ?? 0,
          top + Math.ceil(total / from.columns) * from.rowHeight
        ),
        toY,
        shift: fromY - toY,
        start: startRow * from.columns,
        end: Math.min(total, (endRow + 1) * from.columns),
      });
    } else {
      setMove(null);
      scrollTo(toY);
    }
  }
  // The move's animation over (or cut short by a drag)
  const endMove = (m: Move) => setEnding({ move: m, step: 1 });
  useEffect(() => {
    if (!move || endStep === 0) return;
    const frame = requestAnimationFrame(() => {
      if (endStep < 3) {
        // Without the scroll view following: it scrolls to the new place with the shift going
        if (endStep === 1 && !CAN_FOLLOW) scrollTo(move.toY);
        setEnding({ move, step: endStep + 1 });
        return;
      }
      if (Math.abs(scrollY.current - move.toY) >= 2) scrollTo(move.toY);
      setMove((current) => (current === move ? null : current));
    });
    return () => cancelAnimationFrame(frame);
  }, [move, endStep]);
  // Animating: from the move's first render to its animation's end
  const animating = move != null && endStep === 0;
  const moving = useRef(false);
  moving.current = move != null;
  const endMoveRef = useRef(endMove);
  endMoveRef.current = endMove;
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
    animation.start(({ finished }) => {
      if (finished) endMoveRef.current(move);
    });
    return () => animation.stop();
  }, [move, running]);
  // Settled: no move under way (the Library starts its preview then)
  useEffect(() => {
    if (!move) onSettled?.();
  }, [move, renderedLayout, onSettled]);
  // The buffer grows once the cards are in place
  useEffect(() => {
    if (move || buffer >= screenRows) return;
    const frame = requestAnimationFrame(() =>
      setBuffer((b) => Math.min(screenRows, b + 1))
    );
    return () => cancelAnimationFrame(frame);
  }, [move, buffer, screenRows]);
  // See pendingY
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
  }, [scrollSeq]);

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
      if (pendingY.current != null && Math.abs(y - pendingY.current) < 2)
        pendingY.current = null;
      const row = Math.max(
        0,
        Math.floor((y - top + rowHeight / 2) / rowHeight)
      );
      anchor.current = row * columns;
      // The rendered cards follow every half screen (they reach a screen past the view); not while a move ends (see
      // Move: no card may go but by the move's shift)
      if (
        !moving.current &&
        Math.abs(row - Math.floor(firstRef.current / columns)) >=
          Math.max(1, Math.floor(screenRows / 2))
      )
        setFirst(row * columns);
      onScroll(e);
    },
    [top, rowHeight, columns, screenRows, onScroll]
  );

  // Where a card is drawn during a move: from its place in the old layout to its place in this one, as seen from where
  // the scroll view is (see Move: the cards are laid out `shift` lower). Transforms scale around the card's center, so
  // the translation makes up for that.
  const moveStyle = (index: number) => {
    if (!move || endStep >= 1) return null;
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
          { translateY: enter(ENTER_RISE, 0) },
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
          translateY: at(oldY - (y - toY) - (cardHeight * (1 - scale)) / 2, 0),
        },
        {
          scale: at(scale, 1),
        },
      ],
    };
  };

  // Which slot shows each index in the range (see Pool). Done during render, idempotently: a render done again (or
  // dropped) finds its own assignments already made.
  const { slots, cards: last } = pool.current;
  const shown = new Map<number, number>();
  slots.forEach((index, slot) => {
    if (index != null && index >= start && index < end) shown.set(index, slot);
  });
  const distance = (index: number | null) =>
    index == null ? Infinity : index < start ? start - index : index - end;
  const free = slots
    .map((_, slot) => slot)
    .filter((slot) => {
      const index = slots[slot];
      return index == null || shown.get(index) !== slot;
    })
    .sort((a, b) => distance(slots[b] ?? null) - distance(slots[a] ?? null));
  for (let index = start; index < end; index++) {
    if (shown.has(index)) continue;
    const slot = free.shift() ?? slots.length;
    slots[slot] = index;
    shown.set(index, slot);
  }

  const height = move
    ? Math.max(contentHeight, move.fromHeight)
    : contentHeight;
  const content = slots.map((index, slot) => {
    // collapsable: the wrapper has only layout props most of the time, so Fabric would flatten it away, and make
    // it a view again for a move's transform or for parking: moving the card's views out of the content and back
    // in each time (their images came back blank, some of them).
    if (index == null || shown.get(index) !== slot)
      return (
        <Animated.View key={slot} style={PARKED} collapsable={false}>
          {last[slot]}
        </Animated.View>
      );
    const video = videos[index - start];
    const card = (
      <LibraryCard
        client={cards.client}
        onPress={cards.onPress}
        onAddTag={cards.onAddTag}
        onAddPerformer={cards.onAddPerformer}
        focus={cards.focus}
        held={cards.held}
        onHold={cards.onHold}
        onRelease={cards.onRelease}
        selected={video != null && cards.selectedId === video.id}
        video={video}
        view={view}
        index={index}
        width={cardWidth}
        height={cardHeight}
        moving={animating}
      />
    );
    last[slot] = card;
    return (
      <Animated.View
        key={slot}
        style={[
          {
            position: 'absolute' as const,
            left: padX + (index % columns) * (cardWidth + gapX),
            top:
              top +
              Math.floor(index / columns) * rowHeight +
              (move && endStep < 2 ? move.shift : 0),
          },
          moveStyle(index),
        ]}
        collapsable={false}
        // During a move, each card is drawn once into a layer of its own, which the move then fades, scales and
        // places: a card fading in was drawn again every frame through an offscreen buffer (most of the move's
        // frames' time, with a screen of new cards)
        renderToHardwareTextureAndroid={animating}
      >
        {card}
      </Animated.View>
    );
  });

  return (
    <ScrollView
      ref={scrollRef}
      onScroll={handleScroll}
      maintainVisibleContentPosition={
        CAN_FOLLOW && (endStep === 1 || endStep === 2) ? FOLLOW : undefined
      }
      // The mount the scroll view scrolls in (see REDRAW)
      style={endStep === 2 ? REDRAW : undefined}
      onScrollBeginDrag={() => {
        pendingY.current = null; // the user scrolls now
        if (move && animating) {
          // The cards to their end places at once, the scroll view there under the finger
          move.progress.stopAnimation();
          move.progress.setValue(1);
          endMove(move);
        }
        onScrollBeginDrag();
      }}
      onScrollEndDrag={onScrollEndDrag}
      scrollEventThrottle={16}
      contentContainerStyle={{ height }}
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
        <WheelCapture onWheel={onWheel}>
          <View style={{ height }}>{content}</View>
        </WheelCapture>
      ) : (
        content
      )}
    </ScrollView>
  );
}
