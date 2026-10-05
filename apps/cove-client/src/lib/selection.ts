import { useCallback, useSyncExternalStore } from 'react';

/**
 * One value many components watch, each re-rendering only when its own answer changes (the grid's previewing
 * card: when it moves, the two cards concerned re-render, not the whole grid).
 */
export interface Selection<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

export function createSelection<T>(initial: T): Selection<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A range of grid indices, inclusive; empty when last < first. */
export interface IndexRange {
  first: number;
  last: number;
}

export const NO_RANGE: IndexRange = { first: 0, last: -1 };

/** Whether `index` is in the selected range (re-renders on changes of that answer only). */
export function useInRange(
  selection: Selection<IndexRange>,
  index: number
): boolean {
  const inRange = useCallback(() => {
    const range = selection.get();
    return index >= range.first && index <= range.last;
  }, [selection, index]);
  return useSyncExternalStore(selection.subscribe, inRange, inRange);
}

/** Whether the selection is `key` (re-renders on changes of that answer only). */
export function useIsSelected<T>(selection: Selection<T>, key: T): boolean {
  const isSelected = useCallback(
    () => Object.is(selection.get(), key),
    [selection, key]
  );
  return useSyncExternalStore(selection.subscribe, isSelected, isSelected);
}
