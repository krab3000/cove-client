import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { primaryFile, type CoveClient } from '../../../api/cove';
import type { Video } from '../../../api/types';
import { fonts, nocturne as n } from '../../../theme/tokens';
import {
  formatDuration,
  resolutionLabel,
  videoTitle,
  groupLabel,
  stars,
  videoMeta,
} from '../../../utils/format';
import { Icon } from '../../../ui/Icon';

import { Button } from '../../../ui/Button';
import { CloseButton } from '../../../ui/IconButton';
import { Rule, SectionLabel } from '../../../ui/Text';
import { PersonChip, TagChip } from '../../../ui/Chip';
import { RatingPill, ThumbBadge, ResumeBar } from '../../../ui/Thumb';
import { MarkToggle } from '../../../ui/Toggle';
import {
  usePersonal,
  useSegments,
  useToggleFavorite,
  useToggleSavedForLater,
} from '../../../data/personal';

/**
 * The tablet Library's preview (design 1h, in a Drawer): the video picked in the grid — a header with ✕; its cover with the rating, the resume
 * bar and a tick per segment; title and meta; Resume / Play, Save for later, Favorite; the moments (Cove's segments,
 * each plays from there); people and tags (a tap adds one to the filter); the group.
 */
export function VideoDetail({
  client,
  video,
  onPlay,
  onAddTag,
  onAddPerformer,
  onClose,
}: {
  client: CoveClient;
  video: Video;
  // From a moment's start, or from where the user left off
  onPlay: (video: Video, startAt?: number) => void;
  onAddTag: (tag: { id: number; name: string }) => void;
  onAddPerformer: (performer: { id: number; name: string }) => void;
  onClose: () => void;
}) {
  const personal = usePersonal(video);
  const segments = useSegments(video);
  const onToggleFavorite = useToggleFavorite();
  const onToggleLater = useToggleSavedForLater();

  const file = primaryFile(video);
  const duration = file?.duration ?? 0;
  const badge = [resolutionLabel(video), formatDuration(duration)]
    .filter(Boolean)
    .join(' · ');
  const rating = personal?.rating ? stars(personal.rating) : null;
  const meta = videoMeta(video, personal ? personal.playCount : null);
  const progress = personal?.progress ?? 0;
  const left = Math.round((duration * (1 - progress)) / 60);
  const group = video.groups?.[0];
  const people = video.performers ?? [];
  const tags = video.tags ?? [];

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <SectionLabel>Preview</SectionLabel>
        <CloseButton onPress={onClose} accessibilityLabel="Close the preview" />
      </View>
      <Pressable
        onPress={() => onPlay(video)}
        accessibilityLabel={`Play ${videoTitle(video)}`}
        style={styles.cover}
      >
        <Image
          source={{ uri: client.imageUrl(video) }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          resizeMethod="resize"
        />
        {rating ? <RatingPill stars={rating} /> : null}
        <View style={styles.playRound}>
          <Icon name="play" fill size={22} color={n.text} />
        </View>
        <ThumbBadge text={badge} size="md" />
        {progress > 0 ? <ResumeBar progress={progress} height={3} /> : null}
        {duration > 0
          ? segments.map((s) => (
              <View
                key={s.id}
                pointerEvents="none"
                style={[
                  styles.tick,
                  { left: `${(s.startSec / duration) * 100}%` },
                ]}
              />
            ))
          : null}
      </Pressable>
      <View>
        <Text style={styles.title}>{videoTitle(video)}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      <View style={styles.actions}>
        <Button
          label={progress > 0 ? `Resume · ${left} min left` : 'Play'}
          icon="play"
          iconFill
          grow
          onPress={() => onPlay(video)}
        />
        <MarkToggle
          kind="later"
          shape="square"
          on={!!personal?.savedForLater}
          onPress={() => onToggleLater(video)}
        />
        <MarkToggle
          kind="favorite"
          shape="square"
          on={!!personal?.favorite}
          onPress={() => onToggleFavorite(video)}
        />
      </View>
      {segments.length ? (
        <>
          <Rule />
          <SectionLabel>Moments</SectionLabel>
          <View style={styles.moments}>
            {segments.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => onPlay(video, s.startSec)}
                style={({ pressed }) => [
                  styles.moment,
                  pressed && styles.pressed,
                ]}
              >
                <Image
                  source={{ uri: client.frameUrl(video, s.startSec) }}
                  style={styles.momentThumb}
                  resizeMethod="resize"
                />
                <Text style={styles.momentLabel} numberOfLines={1}>
                  {s.title?.trim() || s.tagName || s.kind || 'Moment'}
                </Text>
                <Text style={styles.momentTime}>
                  {formatDuration(s.startSec)}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {people.length || tags.length ? (
        <>
          <SectionLabel>People & tags</SectionLabel>
          <View style={styles.chips}>
            {people.map((p) => (
              <PersonChip
                key={`p${p.id}`}
                name={p.name}
                onPress={() => onAddPerformer(p)}
                accessibilityLabel={`Add ${p.name} to the filter`}
              />
            ))}
            {tags.map((t) => (
              <TagChip
                key={`t${t.id}`}
                label={t.name}
                onPress={() => onAddTag(t)}
                accessibilityLabel={`Add ${t.name} to the filter`}
              />
            ))}
          </View>
        </>
      ) : null}
      {group ? (
        <View style={styles.group}>
          <Icon name="stack" size={14} color={n.accent300} />
          <Text style={styles.groupText}>{groupLabel(group)}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  content: { padding: 20, paddingTop: 14, paddingBottom: 28, gap: 14 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: -8,
    marginBottom: -4,
  },
  cover: {
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: n.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playRound: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,15,24,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(233,233,237,0.3)',
  },
  tick: {
    position: 'absolute',
    bottom: 0,
    width: 2,
    height: 9,
    borderRadius: 1,
    backgroundColor: n.accent300,
  },
  title: {
    color: n.text,
    fontSize: 21,
    lineHeight: 27,
    fontFamily: fonts.medium,
  },
  meta: {
    marginTop: 4,
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
  actions: { flexDirection: 'row', gap: 8 },
  pressed: { backgroundColor: n.textAlpha(6) },
  moments: { gap: 4, marginTop: -6 },
  moment: {
    padding: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: n.radiusMd,
  },
  momentThumb: {
    width: 64,
    height: 36,
    borderRadius: 4,
    backgroundColor: n.bg,
  },
  momentLabel: {
    flex: 1,
    color: n.text,
    fontSize: 13,
    fontFamily: fonts.regular,
  },
  momentTime: {
    color: n.accent300,
    fontSize: 12,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  groupText: {
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
});
