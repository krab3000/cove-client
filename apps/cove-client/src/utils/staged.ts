import { useEffect, useState } from 'react';

// Components waiting to render in full, oldest first (a Set keeps insertion order: the grid mounts its cards in
// order, so the ones in view come first).
const waiting = new Set<() => void>();
let scheduled = false;
// How many complete per frame: few enough that each frame's native work stays short, so touches get through.
const PER_FRAME = 6;
// Until when nothing completes (see holdStaged)
let heldUntil = 0;

/** Completes nothing for `ms`: while an animation plays, which each frame's native work would make stutter. */
export function holdStaged(ms: number) {
  heldUntil = Math.max(heldUntil, Date.now() + ms);
}

function pump() {
  scheduled = false;
  if (Date.now() < heldUntil) {
    schedule();
    return;
  }
  const batch = [...waiting].slice(0, PER_FRAME);
  for (const complete of batch) waiting.delete(complete);
  // One render and one commit for the batch (React batches the updates).
  for (const complete of batch) complete();
  schedule();
}

function schedule() {
  if (scheduled || !waiting.size) return;
  scheduled = true;
  requestAnimationFrame(pump);
}

const NONE = Symbol('none');

/**
 * false when the component mounts (and when `key` changes), then true a few frames later. For list items that render
 * cheap at first and in full afterwards: a view switch or a scroll mounts a few dozen at once, and mounting them all
 * in full in one go kept the UI thread busy (and touches waiting) for a few hundred milliseconds on slow devices.
 * Here they complete a few per frame, in the order they asked. `key` names what "in full" is (a grid card's details
 * are another thing than a list card's), so another key starts over.
 */
export function useStaged(key: unknown = true): boolean {
  const [completed, setCompleted] = useState<unknown>(NONE);
  const complete = Object.is(completed, key);
  useEffect(() => {
    if (complete) return;
    const done = () => setCompleted(key);
    waiting.add(done);
    schedule();
    return () => {
      waiting.delete(done);
    };
  }, [complete, key]);
  return complete;
}
