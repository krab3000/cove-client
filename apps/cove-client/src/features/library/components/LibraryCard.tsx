import { memo, useEffect, useState } from 'react';
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
  groupLabel,
  resolutionLabel,
  stars,
  videoMeta,
  videoSubtitle,
  videoTitle,
} from '../../../utils/format';
import { HoverPreview } from './HoverPreview';
import { Icon } from '../../../ui/Icon';
import {
  useInRange,
  useIsSelected,
  type IndexRange,
  type Selection,
} from '../../../utils/selection';
import {
  LoadingBar,
  RatingPill,
  ResumeBar,
  ThumbBadge,
} from '../../../ui/Thumb';
import { PersonChip, TagChip } from '../../../ui/Chip';
import { MarkToggle } from '../../../ui/Toggle';
import {
  usePersonal,
  useToggleFavorite,
  useToggleSavedForLater,
} from '../../../data/personal';
import { useStaged } from '../../../utils/staged';
import type { LibraryView } from './LibraryHeader';

/** What every card of the grid gets from the Library (the same object for all of them). */
export type CardActions = {
  client: CoveClient;
  // Large screen: the video in the preview drawer (accent ring, title in accent)
  selectedId: number | null;
  onPress: (video: Video) => void;
  onAddTag: (tag: { id: number; name: string }) => void;
  onAddPerformer: (performer: { id: number; name: string }) => void;
  // Touch: the grid's previewing cards (by index) and the one pressed and held (by video id; the grid decides when
  // that ends, as the finger may go on to scroll the list).
  focus: Selection<IndexRange>;
  held: Selection<number | null>;
  onHold: (video: Video) => void;
  onRelease: (video: Video) => void;
};

type CardProps = Omit<CardActions, 'selectedId'> & {
  video: Video;
  view: LibraryView;
  width: number;
  // Every card is this tall (the grid's rows have a fixed height, see layout.ts).
  height: number;
  index: number; // in the grid
  selected: boolean;
};

/**
 * A Library card, in all three views: a grid tile (design 1f) or a list card (1g). The cover (or a placeholder until
 * Cove's generate task has made one) is the same in every view, and so is this component: switching views moves and
 * resizes the cards that stay on screen (the grid keys them by video) instead of making new ones, and their covers
 * are not loaded again.
 *
 * It renders in two steps. Mounted, it is the cover in its frame only; the details (badges, titles, the preview,
 * the user's data and the touch handling) follow a few cards per frame (useStaged), so the UI thread is never busy
 * for long. Switched between a tile and a list card, the details change the same way.
 */
export const LibraryCard = memo(function LibraryCard(props: CardProps) {
  const { client, video, view, width, height, selected } = props;
  const list = view === 'list';
  const complete = useStaged(list ? 'row' : 'tile');
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const thumbHeight = Math.round((width * 9) / 16);
  const file = primaryFile(video);

  return (
    <View style={{ width, height }}>
      <View
        style={[
          styles.thumb,
          list ? styles.thumbList : styles.thumbTile,
          { height: thumbHeight },
          !list && (hovered || selected) && styles.thumbHover,
          !list && selected && styles.thumbSelected,
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
            // One address in every view (Cove serves generated covers at full size anyway), so a view switch
            // keeps the loaded image.
            source={{ uri: client.imageUrl(video) }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            // Cove serves generated covers at the video's resolution (it ignores ?max= for them): a 4K cover is
            // 33 MB decoded. Android decodes it downsampled to the card's size instead.
            resizeMethod="resize"
            onError={() => setImageFailed(true)}
          />
        )}
      </View>
      {complete ? (
        list ? (
          <RowDetails {...props} thumbHeight={thumbHeight} />
        ) : (
          <TileDetails
            {...props}
            thumbHeight={thumbHeight}
            hovered={hovered}
            onHover={setHovered}
          />
        )
      ) : null}
    </View>
  );
});

/** The preview of a card: shown hovered (desktop), pressed and held, or in the middle of the screen (touch). */
function usePreview(
  video: Video,
  index: number,
  focus: Selection<IndexRange>,
  heldSelection: Selection<number | null>,
  hovered: boolean
) {
  const held = useIsSelected(heldSelection, video.id);
  const autoplay = useInRange(focus, index);
  const show = hovered || held || autoplay;
  // The loading bar runs from the preview being chosen until it plays (or turns out to have nothing to play).
  const [state, setState] = useState<'loading' | 'playing' | 'none'>('loading');
  useEffect(() => {
    if (show) setState('loading');
  }, [show]);
  return { show, loading: show && state === 'loading', setState };
}

function badgeText(video: Video) {
  const file = primaryFile(video);
  return [resolutionLabel(video), formatDuration(file?.duration)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A grid tile past its cover: over the cover one "resolution · duration" badge, a heart on the user's favorites and
 * the resume bar; the title, and in the roomier grid the studio and date; and the touch area over all of it.
 */
function TileDetails({
  client,
  video,
  view,
  width,
  index,
  focus,
  held,
  onPress,
  onHold,
  onRelease,
  selected,
  thumbHeight,
  hovered,
  onHover,
}: CardProps & {
  thumbHeight: number;
  hovered: boolean;
  onHover: (hovered: boolean) => void;
}) {
  // The user's own: a favorite, and how far they got (0–1; 0 = not started)
  const personal = usePersonal(video);
  const favorite = !!personal?.favorite;
  const progress = personal?.progress ?? 0;
  const preview = usePreview(video, index, focus, held, hovered);
  // Inside the cover's border (the hover and selection ring)
  const inset = selected ? 2 : 1;
  return (
    <>
      <View
        style={[
          styles.coverLayer,
          styles.coverLayerTile,
          {
            top: inset,
            left: inset,
            right: inset,
            height: thumbHeight - 2 * inset,
          },
        ]}
      >
        {preview.show ? (
          <HoverPreview
            client={client}
            video={video}
            onState={preview.setState}
            width={width - 2 * inset}
            height={thumbHeight - 2 * inset}
          />
        ) : null}
        {preview.loading ? <LoadingBar /> : null}
        {favorite ? (
          <View style={styles.heart}>
            <Icon name="heart" fill size={10} color={n.accent300} />
          </View>
        ) : null}
        <ThumbBadge text={badgeText(video)} />
        {progress > 0 ? <ResumeBar progress={progress} height={2} /> : null}
      </View>
      <Text
        style={[styles.tileTitle, selected && styles.tileTitleSelected]}
        numberOfLines={1}
      >
        {videoTitle(video)}
      </Text>
      {view === 'grid2' ? (
        <Text style={styles.tileSubtitle} numberOfLines={1}>
          {videoSubtitle(video)}
        </Text>
      ) : null}
      {/* Over the whole card, last: it takes the touches (and the mouse) */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={videoTitle(video)}
        onPress={() => onPress(video)}
        onHoverIn={() => onHover(true)}
        onHoverOut={() => onHover(false)}
        delayLongPress={300}
        onLongPress={() => onHold(video)}
        onPressOut={() => onRelease(video)}
      />
    </>
  );
}

/**
 * A list card past its cover, to decide without opening the video: Cove's rating, resolution and duration over the
 * cover; title; studio, date and play count; Save for later and Favorite; the group, people and tags (one tapped goes
 * into the filter).
 */
function RowDetails({
  client,
  video,
  width,
  index,
  focus,
  held,
  onPress,
  onAddTag,
  onAddPerformer,
  onHold,
  onRelease,
  thumbHeight,
}: CardProps & { thumbHeight: number }) {
  const personal = usePersonal(video);
  const onToggleFavorite = useToggleFavorite();
  const onToggleLater = useToggleSavedForLater();
  const [hovered, setHovered] = useState(false);
  const preview = usePreview(video, index, focus, held, hovered);
  const rating = personal?.rating ? stars(personal.rating) : null;
  const meta = videoMeta(video, personal ? personal.playCount : null);
  const group = video.groups?.[0];

  return (
    <>
      <View
        style={[
          styles.coverLayer,
          styles.coverLayerList,
          { height: thumbHeight },
        ]}
      >
        {preview.show ? (
          <HoverPreview
            client={client}
            video={video}
            onState={preview.setState}
            width={width}
            height={thumbHeight}
          />
        ) : null}
        {preview.loading ? <LoadingBar /> : null}
        {rating ? <RatingPill stars={rating} /> : null}
        <ThumbBadge text={badgeText(video)} size="md" />
        {personal && personal.progress > 0 ? (
          <ResumeBar progress={personal.progress} height={3} />
        ) : null}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={videoTitle(video)}
          onPress={() => onPress(video)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          delayLongPress={300}
          onLongPress={() => onHold(video)}
          onPressOut={() => onRelease(video)}
        />
      </View>
      <View style={styles.titleRow}>
        <Pressable style={styles.titleBlock} onPress={() => onPress(video)}>
          <Text style={styles.rowTitle} numberOfLines={1}>
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
    </>
  );
}

/** A card whose video is still loading. */
export function PlaceholderCard({
  width,
  height,
  list,
}: {
  width: number;
  height: number;
  list: boolean;
}) {
  return (
    <View style={{ width, height }}>
      <View
        style={[
          styles.thumb,
          list ? styles.thumbList : styles.thumbTile,
          { height: Math.round((width * 9) / 16) },
        ]}
      />
      <View style={styles.skeleton} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Rounded on its own: React Native Windows does not clip children to a parent's rounded corners.
  thumb: {
    overflow: 'hidden',
    backgroundColor: n.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbTile: { borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  // The same border width as a tile's: a card switched between the views keeps its frame, and on Android a frame
  // whose border width changed went on clipping its cover away entirely (the cover showed again only once remounted).
  thumbList: { borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  thumbHover: { borderColor: n.accent },
  thumbSelected: { borderWidth: 2 },
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
  // The details' layer over the cover: its place, size and corners (absolute, so the card's column flows on under
  // it as if it were not there)
  coverLayer: { position: 'absolute', overflow: 'hidden' },
  coverLayerTile: { borderRadius: 5 },
  coverLayerList: { top: 0, left: 0, right: 0, borderRadius: 14 },
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
  // Fixed heights: see tileTextHeight.
  tileTitle: {
    color: n.text,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 16,
    height: 16,
    marginTop: 5,
  },
  tileTitleSelected: { color: n.accent300 },
  tileSubtitle: {
    color: n.textAlpha(55),
    fontSize: 11.5,
    fontFamily: fonts.regular,
    lineHeight: 15,
    height: 15,
    marginTop: 1,
  },
  titleRow: {
    marginTop: 10,
    height: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 3, marginRight: 4 },
  rowTitle: {
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
  skeleton: {
    height: 10,
    width: '70%',
    borderRadius: 4,
    marginTop: 8,
    backgroundColor: n.surface,
  },
});
