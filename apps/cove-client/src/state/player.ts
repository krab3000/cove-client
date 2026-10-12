import { asyncBegin, asyncEnd } from 'rn-trace';
import { proxy, ref } from 'valtio';
import type { Video } from '../api/types';

export interface Playing {
  video: Video;
  // The videos after it in the Library's order (the player's Up next)
  upNext: Video[];
  // Where to start (a moment), instead of where the user left off
  startAt?: number;
}

/** What the player shows over the Library, if anything. The videos stay plain objects (ref), not proxies. */
export const player = proxy({ playing: null as Playing | null });

// Trace (rn-trace, category "app"): from play() to the first frame on screen, next to libav's own spans.
let startSpan: number | null = null;

function endStartSpan() {
  if (startSpan !== null) asyncEnd(startSpan);
  startSpan = null;
}

export function play(video: Video, upNext: Video[], startAt?: number) {
  endStartSpan();
  startSpan = asyncBegin(`play ${video.title ?? video.id} → first frame`);
  player.playing = ref({ video, upNext, startAt });
}

/** The player shows its first frame (its first progress report). */
export function firstFrameShown() {
  endStartSpan();
}

export function closePlayer() {
  endStartSpan();
  player.playing = null;
}
