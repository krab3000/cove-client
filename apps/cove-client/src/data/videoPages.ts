import {
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import type { FilterExpression, PaginatedResponse, Video } from '../api/types';
import { useClient } from './client';

/** Videos per page asked of Cove. */
export const PER_PAGE = 40;

/** One list of the Library: a filter, a search and an order (Cove's seeded random, or newest first). */
export interface VideoListQuery {
  filter: FilterExpression | null;
  q: string;
  seed: number | null;
}

/** A list's pages, as the grid's rows read them. */
export interface VideoPages {
  // Another filter, search or order: another key (and pages of its own)
  key: string;
  page: (page: number) => {
    queryKey: readonly unknown[];
    queryFn: () => Promise<PaginatedResponse<Video>>;
    staleTime: number;
  };
}

/**
 * The Library's videos, page by page from the query cache: the first page says how many there are; ensure() loads
 * the pages for a range of indices (those in view and a screen around them). A page that failed is left alone until
 * retry(). refresh() starts the list again from the server.
 */
export function useVideoPages(query: VideoListQuery) {
  const client = useClient();
  const qc = useQueryClient();
  const key = useMemo(
    () => JSON.stringify([query.filter, query.q, query.seed]),
    [query.filter, query.q, query.seed]
  );
  const pages: VideoPages = useMemo(
    () => ({
      key,
      page: (page: number) => ({
        queryKey: ['videos', key, page] as const,
        queryFn: () =>
          client.findVideos(
            page + 1,
            PER_PAGE,
            query.filter,
            query.seed,
            query.q
          ),
        // A page stays as it came until the list is refreshed: rows mount and unmount as the grid scrolls
        staleTime: Infinity,
      }),
    }),
    // query's fields are in key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, key]
  );
  const first = useQuery(pages.page(0));
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const ensure = useCallback(
    (firstIndex: number, lastIndex: number) => {
      for (
        let page = Math.floor(firstIndex / PER_PAGE);
        page <= Math.floor(lastIndex / PER_PAGE);
        page++
      ) {
        const state = qc.getQueryState(pages.page(page).queryKey);
        if (state?.data || state?.status === 'error') continue;
        if (state?.fetchStatus === 'fetching') continue;
        qc.fetchQuery(pages.page(page)).then(
          () => setLoadError(''),
          (e) => setLoadError(e instanceof Error ? e.message : String(e))
        );
      }
    },
    [qc, pages]
  );

  const retry = useCallback(() => {
    setLoadError('');
    qc.resetQueries({
      queryKey: ['videos', key],
      predicate: (q) => q.state.status === 'error',
    });
  }, [qc, key]);

  const refresh = useCallback(() => {
    setLoadError('');
    setRefreshing(true);
    qc.resetQueries({ queryKey: ['videos', key] }).finally(() =>
      setRefreshing(false)
    );
  }, [qc, key]);

  return {
    pages,
    total: first.data?.totalCount ?? null,
    error:
      loadError ||
      (first.error instanceof Error
        ? first.error.message
        : first.error
          ? String(first.error)
          : ''),
    refreshing,
    ensure,
    retry,
    refresh,
    videoAt: useCallback(
      (index: number) => videoAt(qc, pages, index),
      [qc, pages]
    ),
    after: useCallback(
      (id: number, n: number) => after(qc, key, id, n),
      [qc, key]
    ),
  };
}

function videoAt(qc: QueryClient, pages: VideoPages, index: number) {
  return qc.getQueryData<PaginatedResponse<Video>>(
    pages.page(Math.floor(index / PER_PAGE)).queryKey
  )?.items[index % PER_PAGE];
}

/** The loaded videos after one, in the list's order (the player's Up next). */
function after(qc: QueryClient, key: string, id: number, n: number): Video[] {
  const loaded = qc
    .getQueriesData<PaginatedResponse<Video>>({ queryKey: ['videos', key] })
    .map(([k, data]) => ({ page: (k as unknown[])[2] as number, data }))
    .filter((p) => p.data)
    .sort((a, b) => a.page - b.page);
  const next: Video[] = [];
  let found = false;
  for (const { data } of loaded)
    for (const v of data!.items) {
      if (found) next.push(v);
      else if (v.id === id) found = true;
      if (next.length >= n) return next;
    }
  return next;
}

/**
 * A row's videos (count of them from index first): it reads the one or two pages it spans from the cache and
 * re-renders when one of them arrives, and no other time (it never fetches: ensure() does).
 */
export function useRowVideos(
  pages: VideoPages,
  first: number,
  count: number
): (Video | undefined)[] {
  const firstPage = Math.floor(first / PER_PAGE);
  const lastPage = Math.floor((first + Math.max(1, count) - 1) / PER_PAGE);
  return useQueries({
    queries: Array.from({ length: lastPage - firstPage + 1 }, (_, i) => ({
      ...pages.page(firstPage + i),
      enabled: false,
    })),
    combine: (results) =>
      Array.from({ length: count }, (_, i) => {
        const index = first + i;
        return results[Math.floor(index / PER_PAGE) - firstPage]?.data?.items[
          index % PER_PAGE
        ];
      }),
  });
}
