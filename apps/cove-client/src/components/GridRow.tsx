import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CoveClient } from '../api/cove';
import type { Video } from '../api/types';
import { useRowVideos, type VideoPages } from '../data/videoPages';
import type { IndexRange, Selection } from '../lib/selection';
import type { LibraryView } from './LibraryHeader';
import { PlaceholderCard, VideoCard } from './VideoCard';
import { VideoRow } from './VideoRow';

/**
 * One row of the Library's grid: its videos (or placeholders while their page loads) as tiles or list cards. It
 * reads its page(s) from the cache itself, so a page arriving re-renders its rows only.
 */
export const GridRow = memo(function GridRow({
  row,
  columns,
  total,
  pages,
  view,
  cardWidth,
  cardHeight,
  rowHeight,
  gapX,
  padX,
  gapY,
  client,
  selectedId,
  onPress,
  onAddTag,
  onAddPerformer,
  focus,
  held,
  onHold,
  onRelease,
}: {
  row: number;
  columns: number;
  total: number;
  pages: VideoPages;
  view: LibraryView;
  cardWidth: number;
  cardHeight: number;
  rowHeight: number;
  gapX: number;
  padX: number;
  gapY: number;
  client: CoveClient;
  // The video in the preview drawer (ringed), if any
  selectedId: number | null;
  onPress: (video: Video) => void;
  onAddTag: (tag: { id: number; name: string }) => void;
  onAddPerformer: (performer: { id: number; name: string }) => void;
  focus: Selection<IndexRange>;
  held: Selection<number | null>;
  onHold: (video: Video) => void;
  onRelease: (video: Video) => void;
}) {
  const first = row * columns;
  const count = Math.max(0, Math.min(columns, total - first));
  const videos = useRowVideos(pages, first, count);
  return (
    <View
      style={[
        styles.row,
        {
          height: rowHeight,
          gap: gapX,
          paddingHorizontal: padX,
          paddingBottom: gapY,
        },
      ]}
    >
      {videos.map((video, i) => {
        const index = first + i;
        return !video ? (
          <PlaceholderCard
            key={`placeholder-${index}`}
            width={cardWidth}
            height={cardHeight}
            thumbRadius={view === 'list' ? 14 : 6}
          />
        ) : view === 'list' ? (
          <VideoRow
            key={video.id}
            client={client}
            video={video}
            imageUrl={client.imageUrl(video)}
            width={cardWidth}
            onPress={onPress}
            onAddTag={onAddTag}
            onAddPerformer={onAddPerformer}
            index={index}
            focus={focus}
            held={held}
            onHold={onHold}
            onRelease={onRelease}
          />
        ) : (
          <VideoCard
            key={video.id}
            client={client}
            video={video}
            imageUrl={client.imageUrl(video, view === 'grid3' ? 320 : 640)}
            width={cardWidth}
            height={cardHeight}
            onPress={onPress}
            selected={selectedId === video.id}
            index={index}
            focus={focus}
            held={held}
            onHold={onHold}
            onRelease={onRelease}
            showStudio={view === 'grid2'}
          />
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});
