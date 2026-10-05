import { StyleSheet, View } from 'react-native';

// The design's shades: dark at the edge, easing out to clear. One gradient (stacked strips of decreasing darkness
// showed seams wherever their edges fell between pixels, e.g. at 1.5x density).
const SHADE_HEIGHT = 144;

const SHADE_GRADIENT = `linear-gradient(to bottom, ${Array.from(
  { length: 9 },
  (_, i) =>
    `rgba(10,11,18,${(0.64 * (1 - i / 8) ** 1.6).toFixed(3)}) ${(i * 12.5).toFixed(1)}%`
).join(', ')})`;

export function Shade({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.shade,
        edge === 'top' ? styles.shadeTop : styles.shadeBottom,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  // 1l
  shade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SHADE_HEIGHT,
    experimental_backgroundImage: SHADE_GRADIENT,
  },
  shadeTop: { top: 0 },
  // The same steps, the darkest at the bottom edge
  shadeBottom: { bottom: 0, transform: [{ scaleY: -1 }] },
});
