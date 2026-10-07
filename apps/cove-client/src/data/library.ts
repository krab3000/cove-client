import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { CoveClient } from '../api/cove';
import type { Aggregate, FilterExpression, SavedFilter } from '../api/types';
import { useClient } from './client';

/** The user's saved filters (videos). */
export function useSavedFilters(): SavedFilter[] {
  const client = useClient();
  return (
    useQuery({
      queryKey: ['savedFilters'],
      queryFn: () => client.savedFilters(),
    }).data ?? []
  );
}

/** Puts a saved filter the server returned (created or updated) into the list, so everything showing it follows. */
export function useKeepSavedFilter(): (filter: SavedFilter) => void {
  const qc = useQueryClient();
  return useCallback(
    (filter: SavedFilter) =>
      qc.setQueryData<SavedFilter[]>(['savedFilters'], (list = []) =>
        list.some((f) => f.id === filter.id)
          ? list.map((f) => (f.id === filter.id ? filter : f))
          : [...list, filter].sort((a, b) => a.name.localeCompare(b.name))
      ),
    [qc]
  );
}

const listKey = (filter: FilterExpression | null, q?: string) =>
  JSON.stringify([filter, q ?? '']);

/** The count line: how many videos a filter and search match, their total duration and size. */
export function useAggregate(
  filter: FilterExpression | null,
  q: string
): Aggregate | null {
  const client = useClient();
  return (
    useQuery({
      queryKey: ['aggregate', listKey(filter, q)],
      queryFn: () => client.aggregateVideos(filter, q),
    }).data ?? null
  );
}

/** How many videos a filter (and search) matches: undefined while asking (or not asked: enabled false). */
export function useVideoCount(
  filter: FilterExpression | null,
  q?: string,
  enabled = true
): number | undefined {
  const client = useClient();
  return useQuery({
    queryKey: ['count', listKey(filter, q)],
    queryFn: () => client.countVideos(filter, q),
    enabled,
  }).data;
}

/** Several counts at once (the sidebar's and the Show sheet's), by the entries' keys. */
export function useVideoCounts(
  entries: { key: string; filter: FilterExpression | null; q?: string }[],
  enabled: boolean
): Record<string, number | undefined> {
  const client = useClient();
  // Stable, so the counts object only changes with the counts (useQueries re-runs an inline combine every render)
  const combine = useCallback(
    (results: { data?: number }[]) =>
      Object.fromEntries(entries.map((e, i) => [e.key, results[i]?.data])),
    [entries]
  );
  return useQueries({
    queries: entries.map((e) => ({
      queryKey: ['count', listKey(e.filter, e.q)],
      queryFn: () => client.countVideos(e.filter, e.q),
      enabled,
    })),
    combine,
  });
}

/** Whether each server answers (Cove's status needs no sign-in): undefined while asking. */
export function useReachability(addresses: string[]): (boolean | undefined)[] {
  return useQueries({
    queries: addresses.map((address) => ({
      queryKey: ['reachable', address],
      queryFn: () => CoveClient.reachable(address),
      retry: false,
      staleTime: 30_000,
    })),
    combine: (results) => results.map((r) => r.data),
  });
}

/** Asks every server again (Try again). */
export function useAskAgain(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.resetQueries({ queryKey: ['reachable'] });
  }, [qc]);
}
