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

export function play(video: Video, upNext: Video[], startAt?: number) {
  player.playing = ref({ video, upNext, startAt });
}

export function closePlayer() {
  player.playing = null;
}
