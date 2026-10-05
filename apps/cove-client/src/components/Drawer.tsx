import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View } from 'react-native';
import { nocturne as n } from '../theme/tokens';

const INSET = 12;
// A swipe right this far (or this fast) closes it
const SWIPE_CLOSE = 90;
const SWIPE_VELOCITY = 0.5;

/**
 * A temporary panel over the right of its parent (design 1h's preview): it floats inset from the edges, opaque and
 * lifted by a shadow, slides in when [open] and out when not, and closes on a swipe right. Taps inside it stay inside
 * it (they don't reach a tap-outside-closes handler on the parent).
 */
export function Drawer({
  open,
  onClose,
  width = 360,
  children,
}: {
  open: boolean;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  // Far enough right to be out of sight, shadow included
  const away = width + 2 * INSET;
  // How far right of its place the drawer is, in dp
  const shift = useRef(new Animated.Value(away)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    const run = Animated.timing(shift, {
      toValue: open ? 0 : away,
      duration: open ? 340 : 220,
      easing: open ? Easing.bezier(0.2, 0.8, 0.2, 1) : Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    run.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => run.stop();
  }, [open, shift, away]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useMemo(() => {
    const settle = () =>
      Animated.spring(shift, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    return PanResponder.create({
      // Horizontal drags only: vertical ones scroll the drawer's content
      onMoveShouldSetPanResponderCapture: (_, g) =>
        g.dx > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => shift.setValue(Math.max(0, g.dx)),
      onPanResponderRelease: (_, g) => {
        if (g.dx > SWIPE_CLOSE || g.vx > SWIPE_VELOCITY) onCloseRef.current();
        else settle();
      },
      onPanResponderTerminate: settle,
      onPanResponderTerminationRequest: () => false,
    });
  }, [shift]);

  if (!mounted) return null;
  return (
    <Animated.View
      {...pan.panHandlers}
      style={[
        styles.drawer,
        {
          width,
          opacity: shift.interpolate({
            inputRange: [0, away],
            outputRange: [1, 0],
          }),
          transform: [{ translateX: shift }],
        },
      ]}
    >
      <View style={styles.inner} onStartShouldSetResponder={() => true}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    top: INSET,
    right: INSET,
    bottom: INSET,
    borderRadius: 22,
    backgroundColor: n.surface,
    boxShadow: `inset 0 0 0 1px ${n.textAlpha(10)}, -12px 0 48px rgba(0,0,0,0.5), 0 24px 60px rgba(0,0,0,0.4)`,
  },
  inner: { flex: 1, borderRadius: 22, overflow: 'hidden' },
});
