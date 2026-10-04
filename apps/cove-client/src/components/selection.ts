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

/** Whether the selection is `key` (re-renders on changes of that answer only). */
export function useIsSelected<T>(selection: Selection<T>, key: T): boolean {
  const isSelected = useCallback(
    () => Object.is(selection.get(), key),
    [selection, key]
  );
  return useSyncExternalStore(selection.subscribe, isSelected, isSelected);
}
