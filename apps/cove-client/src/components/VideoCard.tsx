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
import {
  formatDuration,
  resolutionLabel,
  videoSubtitle,
  videoTitle,
} from '../format';
import { colors } from './Controls';
import { HoverPreview } from './HoverPreview';
import {
  useInRange,
  useIsSelected,
  type IndexRange,
  type Selection,
} from './selection';


/**
 * A grid card: the cover (or a placeholder until Cove's generate task has made one), duration and resolution
 * badges, title and studio/date.
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
}) {
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const previewing = hovered;
  const held = useIsSelected(heldSelection, video.id);
  const autoplay = useInRange(focus, index);
  const showPreview = previewing || held || autoplay;
  // The loading bar runs from the preview being chosen until it plays (or turns out to have nothing to play).
  const [previewState, setPreviewState] = useState<'loading' | 'playing' | 'none'>('loading');
  useEffect(() => {
    if (showPreview) setPreviewState('loading');
  }, [showPreview]);
  const file = primaryFile(video);
  const duration = formatDuration(file?.duration);
  const resolution = resolutionLabel(video);

  return (
    <Pressable
      onPress={() => onPress(video)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      delayLongPress={300}
      onLongPress={() => onHold(video)}
      onPressOut={() => onRelease(video)}
      style={[styles.card, { width, height }, hovered && styles.cardHover]}
    >
      <View style={styles.thumb}>
        {imageFailed ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderCodec}>
              {(file?.videoCodec ?? '').toUpperCase()}
            </Text>
            <Text style={styles.placeholderFormat}>
              {[file?.format, file?.audioCodec].filter(Boolean).join(' · ')}
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
            // The thumbnail, inside the card's 1 px border.
            width={width - 2}
            height={Math.round(((width - 2) * 9) / 16)}
          />
        ) : null}
        {showPreview && previewState === 'loading' ? <LoadingBar /> : null}
        {resolution ? (
          <Text style={[styles.badge, styles.badgeLeft]}>{resolution}</Text>
        ) : null}
        {duration ? (
          <Text style={[styles.badge, styles.badgeRight]}>{duration}</Text>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {videoTitle(video)}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {videoSubtitle(video)}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: 10,
  },
  cardHover: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.accent,
  },
  // Rounded like the card: React Native Windows does not clip children to a parent's rounded corners.
  thumb: {
    aspectRatio: 16 / 9,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#14171d',
  },
  placeholderCodec: { color: colors.textDim, fontSize: 22, fontWeight: '600' },
  placeholderFormat: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  badge: {
    position: 'absolute',
    bottom: 6,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.75)',
    fontSize: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  badgeLeft: { left: 6 },
  badgeRight: { right: 6 },
  // Fixed heights (two title lines, one subtitle line): see CARD_TEXT_HEIGHT.
  title: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    height: 36,
    marginTop: 8,
    marginHorizontal: 10,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 16,
    height: 16,
    marginTop: 3,
    marginHorizontal: 10,
  },
});

/** A stripe sliding along the bottom of the thumbnail: this card's preview is starting. */
function LoadingBar() {
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
    backgroundColor: colors.accent,
  },
});

/** The card's height below its 16:9 thumbnail: title, subtitle, margins, the bottom padding and the border. */
export const CARD_TEXT_HEIGHT = 8 + 36 + 3 + 16 + 10 + 2;

/** A card whose video is still loading. */
export function PlaceholderCard({ width, height }: { width: number; height: number }) {
  return (
    <View style={[styles.card, { width, height }]}>
      <View style={styles.thumb} />
      <View style={[skeletonStyles.skeleton, { width: '70%' }]} />
      <View style={[skeletonStyles.skeleton, skeletonStyles.skeletonShort]} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  skeleton: {
    height: 12,
    borderRadius: 4,
    marginTop: 12,
    marginHorizontal: 10,
    backgroundColor: colors.surfaceHover,
  },
  skeletonShort: { width: '35%', marginTop: 10 },
});
