import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { primaryFile, type CoveClient } from '../api/cove';
import type { Engagement, Segment, Video } from '../api/types';
import { useClient } from './client';

/** The user's own data about a video: Cove's engagement and bookmarks, as a card shows them. */
export interface Personal {
  favorite: boolean;
  savedForLater: boolean;
  rating: number | null; // 0–100
  playCount: number;
  progress: number; // 0–1
}

export const keys = {
  engagement: (id: number) => ['engagement', id] as const,
  later: (id: number) => ['later', id] as const,
  segments: (id: number) => ['segments', id] as const,
};

// Each video's data is its own query; the ids asked for in one turn of the event loop go in one request (a page's
// cards mount together, so a page costs one engagement/batch and one bookmarks/batch).
function batcher<V>(
  fetchMany: (ids: number[]) => Promise<Map<number, V>>,
  missing: V
): (id: number) => Promise<V> {
  let queue = new Map<
    number,
    { resolve: (v: V) => void; reject: (e: unknown) => void }[]
  >();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    const batch = queue;
    queue = new Map();
    timer = null;
    const ids = [...batch.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const found = await fetchMany(chunk);
        for (const id of chunk)
          for (const w of batch.get(id)!) w.resolve(found.get(id) ?? missing);
      } catch (e) {
        for (const id of chunk) for (const w of batch.get(id)!) w.reject(e);
      }
    }
  };
  return (id) =>
    new Promise<V>((resolve, reject) => {
      const waiting = queue.get(id) ?? [];
      waiting.push({ resolve, reject });
      queue.set(id, waiting);
      timer ??= setTimeout(flush, 0);
    });
}

const batchers = new WeakMap<
  CoveClient,
  {
    engagement: (id: number) => Promise<Engagement | null>;
    later: (id: number) => Promise<boolean>;
  }
>();
function batchersOf(client: CoveClient) {
  let b = batchers.get(client);
  if (!b) {
    b = {
      engagement: batcher<Engagement | null>(
        async (ids) =>
          new Map((await client.engagement(ids)).map((e) => [e.hostId, e])),
        null
      ),
      later: batcher<boolean>(async (ids) => {
        const saved = await client.savedForLater(ids);
        return new Map(ids.map((id) => [id, saved.has(id)]));
      }, false),
    };
    batchers.set(client, b);
  }
  return b;
}

/**
 * The user's engagement with a video (rating, favorite, plays, resume): undefined while asking, null if none. fresh:
 * asked again on mount (the player, for where to resume).
 */
export function useEngagement(id: number | undefined, fresh = false) {
  const client = useClient();
  return useQuery({
    queryKey: keys.engagement(id ?? -1),
    queryFn: () => batchersOf(client).engagement(id!),
    enabled: id != null,
    refetchOnMount: fresh ? 'always' : true,
  });
}

/** Whether the user saved a video for later: undefined while asking. */
export function useSavedForLater(id: number | undefined): boolean | undefined {
  const client = useClient();
  return useQuery({
    queryKey: keys.later(id ?? -1),
    queryFn: () => batchersOf(client).later(id!),
    enabled: id != null,
  }).data;
}

/** A card's view of the user's data: null until both have answered. */
export function usePersonal(video: Video | null): Personal | null {
  const engagement = useEngagement(video?.id).data;
  const later = useSavedForLater(video?.id);
  if (!video || engagement === undefined || later === undefined) return null;
  const duration = primaryFile(video)?.duration ?? 0;
  return {
    favorite: !!engagement?.isFavorite,
    savedForLater: later,
    rating: engagement?.rating ?? null,
    playCount: engagement?.playCount ?? 0,
    progress:
      engagement && duration > 0
        ? Math.min(1, engagement.resumeTime / duration)
        : 0,
  };
}

function blank(id: number): Engagement {
  return {
    hostId: id,
    isFavorite: false,
    rating: null,
    resumeTime: 0,
    playCount: 0,
  };
}

/** Favorite on or off, at once (the server's answer follows; a failure puts it back). */
export function useToggleFavorite(): (video: Video) => void {
  const client = useClient();
  const qc = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      client.setFavorite(id, on),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: keys.engagement(id) });
      const before = qc.getQueryData<Engagement | null>(keys.engagement(id));
      qc.setQueryData(keys.engagement(id), {
        ...(before ?? blank(id)),
        isFavorite: on,
      });
      return { before };
    },
    onError: (_e, { id }, context) =>
      qc.setQueryData(keys.engagement(id), context?.before ?? null),
    onSuccess: (server, { id }) => {
      if (server) qc.setQueryData(keys.engagement(id), server);
    },
  });
  return useCallback(
    (video: Video) =>
      mutate({
        id: video.id,
        on: !qc.getQueryData<Engagement | null>(keys.engagement(video.id))
          ?.isFavorite,
      }),
    [mutate, qc]
  );
}

/** Saved for later on or off, at once (a failure puts it back). */
export function useToggleSavedForLater(): (video: Video) => void {
  const client = useClient();
  const qc = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      client.setSavedForLater(id, on),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: keys.later(id) });
      const before = qc.getQueryData<boolean>(keys.later(id));
      qc.setQueryData(keys.later(id), on);
      return { before };
    },
    onError: (_e, { id }, context) =>
      qc.setQueryData(keys.later(id), context?.before ?? false),
  });
  return useCallback(
    (video: Video) =>
      mutate({
        id: video.id,
        on: !qc.getQueryData<boolean>(keys.later(video.id)),
      }),
    [mutate, qc]
  );
}

/** After playback: the play count and resume time changed on the server. */
export function playbackChanged(qc: QueryClient, id: number) {
  qc.invalidateQueries({ queryKey: keys.engagement(id) });
}

/** A video's segments (the design's moments), asked once: the preview and the player share them. */
export function useSegments(video: Video | null): Segment[] {
  const client = useClient();
  return (
    useQuery({
      queryKey: keys.segments(video?.id ?? -1),
      queryFn: () => client.segments(video!),
      enabled: !!video,
      staleTime: Infinity,
    }).data ?? []
  );
}
