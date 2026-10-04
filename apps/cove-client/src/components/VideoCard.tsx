import { memo, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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

// Hover this long before the preview starts (not while the pointer just passes over cards).
const PREVIEW_DELAY_MS = 400;

/**
 * A grid card: the cover (or a placeholder until Cove's generate task has made one), duration and resolution
 * badges, title and studio/date.
 */
export const VideoCard = memo(function VideoCard({
  client,
  video,
  imageUrl,
  width,
  onPress,
  held,
  onHold,
  onRelease,
}: {
  client: CoveClient;
  video: Video;
  imageUrl: string;
  width: number;
  onPress: (video: Video) => void;
  // Touch: press and hold previews; the grid decides when it ends (the finger may go on to scroll the list).
  held: boolean;
  onHold: (video: Video) => void;
  onRelease: (video: Video) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    if (!hovered) {
      setPreviewing(false);
      return;
    }
    const timer = setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hovered]);
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
      style={[styles.card, { width }, hovered && styles.cardHover]}
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
            onError={() => setImageFailed(true)}
          />
        )}
        {previewing || held ? (
          <HoverPreview client={client} video={video} />
        ) : null}
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
  title: {
    color: colors.text,
    fontSize: 14,
    marginTop: 8,
    marginHorizontal: 10,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: 3,
    marginHorizontal: 10,
  },
});
