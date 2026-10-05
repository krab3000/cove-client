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
  initials,
  stars,
  videoMeta,
} from '../lib/format';
import { Icon } from './Icon';
import { HoverPreview } from './HoverPreview';
import {
  useInRange,
  useIsSelected,
  type IndexRange,
  type Selection,
} from '../lib/selection';
import { LoadingBar, ResumeBar } from './VideoCard';

/** The list card's height for a width: the 16:9 thumbnail, the title block and the chip row (all fixed). */
export function listCardHeight(width: number): number {
  return Math.round((width * 9) / 16) + 10 + 44 + 10 + 28;
}

/** The user's own data about a video, once engagement/batch has answered. */
export interface Personal {
  favorite: boolean;
  savedForLater: boolean;
  rating: number | null; // 0–100
  playCount: number;
  progress: number; // 0–1
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
  personal,
  onPress,
  onAddTag,
  onAddPerformer,
  onToggleFavorite,
  onToggleLater,
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
  personal: Personal | null;
  onPress: (video: Video) => void;
  onAddTag: (tag: { id: number; name: string }) => void;
  onAddPerformer: (performer: { id: number; name: string }) => void;
  onToggleFavorite: (video: Video) => void;
  onToggleLater: (video: Video) => void;
  index: number; // in the list
  focus: Selection<IndexRange>;
  held: Selection<number | null>;
  onHold: (video: Video) => void;
  onRelease: (video: Video) => void;
}) {
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
        {rating ? (
          <View style={styles.rating}>
            <Icon name="star" fill size={11} color={n.accent300} />
            <Text style={styles.ratingText}>{rating}</Text>
          </View>
        ) : null}
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
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
        <RoundToggle
          icon="bookmark-simple"
          label="Save for later"
          on={!!personal?.savedForLater}
          onPress={() => onToggleLater(video)}
        />
        <RoundToggle
          icon="heart"
          label="Favorite"
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
          <Pressable
            key={`p${p.id}`}
            onPress={() => onAddPerformer(p)}
            accessibilityLabel={`Add ${p.name} to the filter`}
            style={({ pressed }) => [styles.person, pressed && styles.pressed]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(p.name)}</Text>
            </View>
            <Text style={styles.chipText}>{p.name}</Text>
          </Pressable>
        ))}
        {(video.tags ?? []).map((t) => (
          <Pressable
            key={`t${t.id}`}
            onPress={() => onAddTag(t)}
            accessibilityLabel={`Add ${t.name} to the filter`}
            style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
          >
            <Text style={styles.chipText}>{t.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
});

function RoundToggle({
  icon,
  label,
  on,
  onPress,
}: {
  icon: 'heart' | 'bookmark-simple';
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.round,
        on && styles.roundOn,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} fill={on} size={20} color={on ? n.accent : n.text} />
    </Pressable>
  );
}

const SCRIM = 'rgba(10,11,18,0.72)';

const styles = StyleSheet.create({
  thumb: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: n.surface,
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
    backgroundColor: 'rgba(10,11,18,0.66)',
  },
  ratingText: {
    color: n.text,
    fontSize: 11.5,
    fontFamily: fonts.semiBold,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    color: n.text,
    backgroundColor: SCRIM,
    fontSize: 11.5,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    overflow: 'hidden',
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
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: n.divider,
  },
  roundOn: { borderColor: n.accent },
  pressed: { opacity: 0.7 },
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
  person: {
    height: 28,
    paddingLeft: 3,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    backgroundColor: n.surface,
    borderWidth: 1,
    borderColor: n.divider,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.accent700,
  },
  avatarText: { color: n.accent100, fontSize: 10, fontFamily: fonts.medium },
  tag: {
    height: 28,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: n.surface,
    borderWidth: 1,
    borderColor: n.divider,
  },
  chipText: { color: n.text, fontSize: 12, fontFamily: fonts.regular },
});
