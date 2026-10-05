import { memo, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { primaryFile, type CoveClient } from '../api/cove';
import type { Video } from '../api/types';
import { fonts, nocturne as n } from '../theme/tokens';
import {
  formatDuration,
  resolutionLabel,
  videoTitle,
  groupLabel,
  stars,
  videoMeta,
} from '../lib/format';
import { Icon } from '../ui/Icon';
import { HoverPreview } from './HoverPreview';
import {
  useInRange,
  useIsSelected,
  type IndexRange,
  type Selection,
} from '../lib/selection';
import { PersonChip, TagChip } from '../ui/Chip';
import { LoadingBar, RatingPill, ResumeBar, ThumbBadge } from '../ui/Thumb';
import { MarkToggle } from '../ui/Toggle';
import {
  usePersonal,
  useToggleFavorite,
  useToggleSavedForLater,
} from '../data/personal';

/** The list card's height for a width: the 16:9 thumbnail, the title block and the chip row (all fixed). */
export function listCardHeight(width: number): number {
  return Math.round((width * 9) / 16) + 10 + 44 + 10 + 28;
}

/**
 * A Library list card (design 1g): one video per row, to decide without opening it. Cove's rating, resolution and
 * duration on the thumbnail; title; studio, date and play count; Save for later and Favorite; the group, people and
 * tags. A person or tag tapped goes into the filter. The preview plays like a grid tile's (the card in the middle of
 * the screen, or one pressed and held; hovered on the desktop).
 */
export const VideoRow = memo(function VideoRow({
  client,
  video,
  imageUrl,
  width,
  onPress,
  onAddTag,
  onAddPerformer,
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
  onPress: (video: Video) => void;
  onAddTag: (tag: { id: number; name: string }) => void;
  onAddPerformer: (performer: { id: number; name: string }) => void;
  index: number; // in the list
  focus: Selection<IndexRange>;
  held: Selection<number | null>;
  onHold: (video: Video) => void;
  onRelease: (video: Video) => void;
}) {
  const personal = usePersonal(video);
  const onToggleFavorite = useToggleFavorite();
  const onToggleLater = useToggleSavedForLater();
  const [imageFailed, setImageFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const held = useIsSelected(heldSelection, video.id);
  const autoplay = useInRange(focus, index);
  const showPreview = hovered || held || autoplay;
  const [previewState, setPreviewState] = useState<
    'loading' | 'playing' | 'none'
  >('loading');
  useEffect(() => {
    if (showPreview) setPreviewState('loading');
  }, [showPreview]);
  const thumbHeight = Math.round((width * 9) / 16);
  const file = primaryFile(video);
  const badge = [resolutionLabel(video), formatDuration(file?.duration)]
    .filter(Boolean)
    .join(' · ');
  const rating = personal?.rating ? stars(personal.rating) : null;
  const meta = videoMeta(video, personal ? personal.playCount : null);
  const group = video.groups?.[0];

  return (
    <View style={{ width, height: listCardHeight(width) }}>
      <Pressable
        onPress={() => onPress(video)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        delayLongPress={300}
        onLongPress={() => onHold(video)}
        onPressOut={() => onRelease(video)}
        style={[styles.thumb, { height: thumbHeight }]}
      >
        {imageFailed ? null : (
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
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
        {rating ? <RatingPill stars={rating} /> : null}
        <ThumbBadge text={badge} size="md" />
        {personal && personal.progress > 0 ? (
          <ResumeBar progress={personal.progress} height={3} />
        ) : null}
      </Pressable>
      <View style={styles.titleRow}>
        <Pressable style={styles.titleBlock} onPress={() => onPress(video)}>
          <Text style={styles.title} numberOfLines={1}>
            {videoTitle(video)}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </Pressable>
        <MarkToggle
          kind="later"
          on={!!personal?.savedForLater}
          onPress={() => onToggleLater(video)}
        />
        <MarkToggle
          kind="favorite"
          on={!!personal?.favorite}
          onPress={() => onToggleFavorite(video)}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chips}
      >
        {group ? (
          <View style={styles.group}>
            <Icon name="stack" size={14} color={n.accent300} />
            <Text style={styles.groupText} numberOfLines={1}>
              {groupLabel(group)}
            </Text>
          </View>
        ) : null}
        {(video.performers ?? []).map((p) => (
          <PersonChip
            key={`p${p.id}`}
            name={p.name}
            onPress={() => onAddPerformer(p)}
            accessibilityLabel={`Add ${p.name} to the filter`}
          />
        ))}
        {(video.tags ?? []).map((t) => (
          <TagChip
            key={`t${t.id}`}
            label={t.name}
            onPress={() => onAddTag(t)}
            accessibilityLabel={`Add ${t.name} to the filter`}
          />
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  thumb: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: n.surface,
  },
  titleRow: {
    marginTop: 10,
    height: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 3, marginRight: 4 },
  title: {
    color: n.text,
    fontSize: 17,
    lineHeight: 22,
    fontFamily: fonts.medium,
  },
  meta: {
    color: n.textAlpha(55),
    fontSize: 12.5,
    lineHeight: 16,
    fontFamily: fonts.regular,
  },
  chipScroll: { marginTop: 10, height: 28, flexGrow: 0 },
  chips: { gap: 6, alignItems: 'center' },
  group: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 4,
  },
  groupText: {
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
});
