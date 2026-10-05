import { memo, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { primaryFile, type CoveClient } from '../api/cove';
import type { Video } from '../api/types';
import { fonts, nocturne as n } from '../filter/theme';
import {
  formatDuration,
  resolutionLabel,
  videoSubtitle,
  videoTitle,
} from '../format';
import { HoverPreview } from './HoverPreview';
import { Icon } from './Icon';
import {
  useInRange,
  useIsSelected,
  type IndexRange,
  type Selection,
} from './selection';

/**
 * A Library grid tile (design 1f): the cover (or a placeholder until Cove's generate task has made one) with one
 * "resolution · duration" badge, a heart on the user's favorites and the resume bar; the title, and in the roomier
 * grid the studio and date.
 */
export const VideoCard = memo(function VideoCard({
  client,
  video,
  imageUrl,
  width,
  height,
  onPress,
  index,
  focus,
  held: heldSelection,
  onHold,
  onRelease,
  showStudio,
  favorite,
  progress,
  selected,
}: {
  client: CoveClient;
  video: Video;
  imageUrl: string;
  width: number;
  // Every card is this tall (the grid's rows have a fixed height, see BrowseScreen).
  height: number;
  onPress: (video: Video) => void;
  index: number; // in the grid
  // Touch: the grid's previewing cards (those wholly on screen, by index) and the one pressed and held (by video
  // id; the grid decides when that ends, as the finger may go on to scroll the list).
  focus: Selection<IndexRange>;
  held: Selection<number | null>;
  onHold: (video: Video) => void;
  onRelease: (video: Video) => void;
  showStudio: boolean;
  // The user's own: a favorite, and how far they got (0–1; 0 = not started)
  favorite: boolean;
  progress: number;
  // Large screen: the video in the detail pane (accent ring, title in accent)
  selected?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const previewing = hovered;
  const held = useIsSelected(heldSelection, video.id);
  const autoplay = useInRange(focus, index);
  const showPreview = previewing || held || autoplay;
  // The loading bar runs from the preview being chosen until it plays (or turns out to have nothing to play).
  const [previewState, setPreviewState] = useState<
    'loading' | 'playing' | 'none'
  >('loading');
  useEffect(() => {
    if (showPreview) setPreviewState('loading');
  }, [showPreview]);
  const file = primaryFile(video);
  const badge = [resolutionLabel(video), formatDuration(file?.duration)]
    .filter(Boolean)
    .join(' · ');
  const thumbHeight = Math.round((width * 9) / 16);

  return (
    <Pressable
      onPress={() => onPress(video)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      delayLongPress={300}
      onLongPress={() => onHold(video)}
      onPressOut={() => onRelease(video)}
      style={{ width, height }}
    >
      <View
        style={[
          styles.thumb,
          { height: thumbHeight },
          (hovered || selected) && styles.thumbHover,
          selected && styles.thumbSelected,
        ]}
      >
        {imageFailed ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderCodec}>
              {(file?.videoCodec ?? '').toUpperCase()}
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            // Cove serves generated covers at the video's resolution (it ignores ?max= for them): a 4K cover is
            // 33 MB decoded. Android decodes it downsampled to the card's size instead.
            resizeMethod="resize"
            onError={() => setImageFailed(true)}
          />
        )}
        {showPreview ? (
          <HoverPreview
            client={client}
            video={video}
            onState={setPreviewState}
            width={width}
            height={thumbHeight}
          />
        ) : null}
        {showPreview && previewState === 'loading' ? <LoadingBar /> : null}
        {favorite ? (
          <View style={styles.heart}>
            <Icon name="heart" fill size={10} color={n.accent300} />
          </View>
        ) : null}
        {badge ? (
          <Text style={styles.badge} numberOfLines={1}>
            {badge}
          </Text>
        ) : null}
        {progress > 0 ? <ResumeBar progress={progress} height={2} /> : null}
      </View>
      <Text
        style={[styles.title, selected && styles.titleSelected]}
        numberOfLines={1}
      >
        {videoTitle(video)}
      </Text>
      {showStudio ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {videoSubtitle(video)}
        </Text>
      ) : null}
    </Pressable>
  );
});

/** The tile's height below its 16:9 thumbnail: the title, and the studio line in the roomier grid. */
export function tileTextHeight(showStudio: boolean): number {
  return 5 + 16 + (showStudio ? 1 + 15 : 0);
}

/** How far the user got: a thin accent bar along the bottom of a thumbnail. */
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

// Over the video: dark in both themes.
const SCRIM = 'rgba(10,11,18,0.72)';

const styles = StyleSheet.create({
  // Rounded on its own: React Native Windows does not clip children to a parent's rounded corners.
  thumb: {
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: n.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  thumbHover: { borderColor: n.accent },
  thumbSelected: { borderWidth: 2 },
  titleSelected: { color: n.accent300 },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: n.surface,
  },
  placeholderCodec: {
    color: n.textAlpha(55),
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  heart: {
    position: 'absolute',
    right: 4,
    top: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,11,18,0.6)',
  },
  badge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    color: n.text,
    backgroundColor: SCRIM,
    fontSize: 10,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(233,233,237,0.22)',
  },
  progress: { height: '100%', backgroundColor: n.accent },
  // Fixed heights: see tileTextHeight.
  title: {
    color: n.text,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 16,
    height: 16,
    marginTop: 5,
  },
  subtitle: {
    color: n.textAlpha(55),
    fontSize: 11.5,
    fontFamily: fonts.regular,
    lineHeight: 15,
    height: 15,
    marginTop: 1,
  },
});

/** A stripe sliding along the bottom of the thumbnail: this card's preview is starting. */
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
      style={loadingStyles.track}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View
          style={[
            loadingStyles.stripe,
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

const loadingStyles = StyleSheet.create({
  track: {
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

/** A tile or list card whose video is still loading. */
export function PlaceholderCard({
  width,
  height,
  thumbRadius = 6,
}: {
  width: number;
  height: number;
  thumbRadius?: number;
}) {
  return (
    <View style={{ width, height }}>
      <View
        style={[
          styles.thumb,
          { height: Math.round((width * 9) / 16), borderRadius: thumbRadius },
        ]}
      />
      <View style={[skeletonStyles.skeleton, { width: '70%' }]} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  skeleton: {
    height: 10,
    borderRadius: 4,
    marginTop: 8,
    backgroundColor: n.surface,
  },
});
