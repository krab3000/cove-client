import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { primaryFile, type CoveClient } from '../api/cove';
import type { Segment, Video } from '../api/types';
import { fonts, nocturne as n } from '../filter/theme';
import { formatDuration, resolutionLabel, videoTitle } from '../format';
import { Icon } from './Icon';
import { ResumeBar } from './VideoCard';
import { partialDate, type Personal } from './VideoRow';

/**
 * The tablet Library's preview (design 1h, in a Drawer): the video picked in the grid — a header with ✕; its cover with the rating, the resume
 * bar and a tick per segment; title and meta; Resume / Play, Save for later, Favorite; the moments (Cove's segments,
 * each plays from there); people and tags (a tap adds one to the filter); the group.
 */
export function VideoDetail({
  client,
  video,
  personal,
  onPlay,
  onToggleFavorite,
  onToggleLater,
  onAddTag,
  onAddPerformer,
  onClose,
}: {
  client: CoveClient;
  video: Video;
  personal: Personal | null;
  // From a moment's start, or from where the user left off
  onPlay: (video: Video, startAt?: number) => void;
  onToggleFavorite: (video: Video) => void;
  onToggleLater: (video: Video) => void;
  onAddTag: (tag: { id: number; name: string }) => void;
  onAddPerformer: (performer: { id: number; name: string }) => void;
  onClose: () => void;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  useEffect(() => {
    let alive = true;
    setSegments([]);
    client.segments(video).then((s) => alive && setSegments(s));
    return () => {
      alive = false;
    };
  }, [client, video]);

  const file = primaryFile(video);
  const duration = file?.duration ?? 0;
  const badge = [resolutionLabel(video), formatDuration(duration)]
    .filter(Boolean)
    .join(' · ');
  const stars = personal?.rating
    ? (Math.round(personal.rating / 10) / 2).toFixed(1)
    : null;
  const meta = [
    video.studioName,
    video.date ? partialDate(video.date) : null,
    personal
      ? personal.playCount
        ? `watched ${personal.playCount}×`
        : 'unwatched'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const progress = personal?.progress ?? 0;
  const left = Math.round((duration * (1 - progress)) / 60);
  const group = video.groups?.[0];
  const people = video.performers ?? [];
  const tags = video.tags ?? [];

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.section}>PREVIEW</Text>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close the preview"
          hitSlop={6}
          style={({ pressed }) => [
            styles.close,
            pressed && styles.closePressed,
          ]}
        >
          <Icon name="x" size={16} color={n.text} />
        </Pressable>
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
        {stars ? (
          <View style={styles.rating}>
            <Icon name="star" fill size={11} color={n.accent300} />
            <Text style={styles.ratingText}>{stars}</Text>
          </View>
        ) : null}
        <View style={styles.playRound}>
          <Icon name="play" fill size={22} color={n.text} />
        </View>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
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
        <Pressable
          onPress={() => onPlay(video)}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.primaryPressed,
          ]}
        >
          <Icon name="play" fill size={14} color={n.accent200} />
          <Text style={styles.primaryText}>
            {progress > 0 ? `Resume · ${left} min left` : 'Play'}
          </Text>
        </Pressable>
        <Toggle
          icon="bookmark-simple"
          label="Save for later"
          on={!!personal?.savedForLater}
          onPress={() => onToggleLater(video)}
        />
        <Toggle
          icon="heart"
          label="Favorite"
          on={!!personal?.favorite}
          onPress={() => onToggleFavorite(video)}
        />
      </View>
      {segments.length ? (
        <>
          <View style={styles.rule} />
          <Text style={styles.section}>MOMENTS</Text>
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
          <Text style={styles.section}>PEOPLE &amp; TAGS</Text>
          <View style={styles.chips}>
            {people.map((p) => (
              <Pressable
                key={`p${p.id}`}
                onPress={() => onAddPerformer(p)}
                accessibilityLabel={`Add ${p.name} to the filter`}
                style={({ pressed }) => [
                  styles.person,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {p.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase() ?? '')
                      .join('')}
                  </Text>
                </View>
                <Text style={styles.chipText}>{p.name}</Text>
              </Pressable>
            ))}
            {tags.map((t) => (
              <Pressable
                key={`t${t.id}`}
                onPress={() => onAddTag(t)}
                accessibilityLabel={`Add ${t.name} to the filter`}
                style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
              >
                <Text style={styles.chipText}>{t.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {group ? (
        <View style={styles.group}>
          <Icon name="stack" size={14} color={n.accent300} />
          <Text style={styles.groupText}>
            {group.videoIndex != null
              ? `${group.name} · part ${group.videoIndex + 1}`
              : group.name}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Toggle({
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
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [
        styles.toggle,
        on && styles.toggleOn,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} fill={on} size={19} color={on ? n.accent : n.text} />
    </Pressable>
  );
}

const SCRIM = 'rgba(10,11,18,0.72)';

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
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: n.textAlpha(8),
  },
  closePressed: { backgroundColor: n.textAlpha(14) },
  cover: {
    aspectRatio: 16 / 9,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: n.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 9,
    color: n.text,
    backgroundColor: SCRIM,
    fontSize: 11,
    fontFamily: fonts.medium,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
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
  primary: {
    flex: 1,
    height: 44,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryPressed: { backgroundColor: n.accentAlpha(12) },
  primaryText: { color: n.accent200, fontSize: 14, fontFamily: fonts.medium },
  toggle: {
    width: 44,
    height: 44,
    borderRadius: n.radiusMd,
    borderWidth: 1,
    borderColor: n.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOn: { borderColor: n.accent },
  pressed: { backgroundColor: n.textAlpha(6) },
  rule: { height: 1, marginHorizontal: 12, backgroundColor: n.divider },
  section: {
    color: n.textAlpha(50),
    fontSize: 12,
    letterSpacing: 1,
    fontFamily: fonts.regular,
  },
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
  person: {
    height: 28,
    paddingLeft: 3,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
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
    borderWidth: 1,
    borderColor: n.divider,
  },
  chipText: { color: n.text, fontSize: 12, fontFamily: fonts.regular },
  group: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  groupText: {
    color: n.textAlpha(55),
    fontSize: 12.5,
    fontFamily: fonts.regular,
  },
});
