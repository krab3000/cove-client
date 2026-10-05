import { useEffect, useRef } from 'react';
import { BackHandler, type NativeEventSubscription } from 'react-native';

/**
 * Android's back, in one place: what is on top handles it. Layers, highest first; within a layer, the latest
 * registered. A handler that returns false passes it on. (Modal sheets close on their own onRequestClose: Android sends
 * back to their window first.)
 */
export const Layer = {
  screen: 0,
  drawer: 10,
  editor: 20,
  player: 100,
} as const;

type Handler = () => boolean | void;
interface Entry {
  id: number;
  layer: number;
  get: () => Handler | null;
}

const entries: Entry[] = [];
let seq = 0;
let subscription: NativeEventSubscription | null = null;

function onBack(): boolean {
  const ordered = [...entries].sort((a, b) => b.layer - a.layer || b.id - a.id);
  for (const entry of ordered) {
    const handler = entry.get();
    if (handler && handler() !== false) return true;
  }
  return false;
}

/** Handles back while `handler` is given (false or null: not now), at `layer`. The latest handler is always used. */
export function useBackHandler(
  handler: Handler | false | null | undefined,
  layer: number
) {
  const current = useRef<Handler | null>(null);
  current.current = handler || null;
  const active = !!handler;
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { id: ++seq, layer, get: () => current.current };
    entries.push(entry);
    subscription ??= BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => {
      entries.splice(entries.indexOf(entry), 1);
      if (!entries.length) {
        subscription?.remove();
        subscription = null;
      }
    };
  }, [active, layer]);
}
