import { asyncBegin, asyncEnd, instant } from 'rn-trace';
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
  endResumeSpan();
  instant(`tap ${video.id}`);
  startSpan = asyncBegin(`play ${video.title ?? video.id} → first frame`);
  player.playing = ref({ video, upNext, startAt });
}

/** The player shows its first frame (its first progress report). */
export function firstFrameShown() {
  endStartSpan();
}

// And from the seek to where the user left off until the player reports it done (the benchmark's resume runs).
let resumeSpan: number | null = null;

function endResumeSpan() {
  if (resumeSpan !== null) asyncEnd(resumeSpan);
  resumeSpan = null;
}

/** The player seeks to where the user left off. */
export function resumeSeek(seconds: number) {
  endResumeSpan();
  resumeSpan = asyncBegin(`resume seek ${Math.round(seconds)} → done`);
}

/** The player finished a seek (onSeek): ends the resume span. */
export function seekDone() {
  endResumeSpan();
}

export function closePlayer() {
  endStartSpan();
  endResumeSpan();
  player.playing = null;
}
