import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fonts, nocturne as n, overVideo } from '../theme/tokens';
import { Icon } from './Icon';

/** Over a thumbnail, bottom right: "resolution · duration". sm on tiles and up-next, md on cards and the preview. */
export function ThumbBadge({
  text,
  size = 'sm',
}: {
  text: string;
  size?: 'sm' | 'md';
}) {
  if (!text) return null;
  return (
    <Text style={[styles.badge, size === 'md' && styles.badgeMd]}>{text}</Text>
  );
}

/** Over a thumbnail, top left: the user's rating in stars ("4.5"). */
export function RatingPill({ stars }: { stars: string }) {
  return (
    <View style={styles.rating}>
      <Icon name="star" fill size={11} color={overVideo.marker} />
      <Text style={styles.ratingText}>{stars}</Text>
    </View>
  );
}

/** Along a thumbnail's bottom edge: how much was watched (0–1). */
export function ResumeBar({
  progress,
  height,
}: {
  progress: number;
  height: number;
}) {
  return (
    <View pointerEvents="none" style={[styles.progressTrack, { height }]}>
      <View
        style={[styles.progress, { width: `${Math.min(1, progress) * 100}%` }]}
      />
    </View>
  );
}

/** Along a thumbnail's bottom edge: a stripe sweeping while its preview loads. */
export function LoadingBar() {
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: 1,
        duration: 900,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: Platform.OS !== 'windows',
      })
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  const stripe = width * 0.35;
  return (
    <View
      pointerEvents="none"
      style={styles.loadingTrack}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View
          style={[
            styles.stripe,
            {
              width: stripe,
              transform: [
                {
                  translateX: x.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-stripe, width],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: overVideo.badge,
    color: overVideo.ink,
    fontSize: 10,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
  badgeMd: {
    right: 8,
    bottom: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    fontSize: 11.5,
  },
  rating: {
    position: 'absolute',
    left: 8,
    top: 8,
    height: 22,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 5,
    backgroundColor: overVideo.badge,
  },
  ratingText: {
    color: overVideo.ink,
    fontSize: 11.5,
    fontFamily: fonts.semiBold,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: overVideo.inkAlpha(22),
  },
  progress: { height: '100%', backgroundColor: n.accent },
  loadingTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  stripe: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: n.accent,
  },
});
