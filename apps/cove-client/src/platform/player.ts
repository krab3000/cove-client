import { VlcVideoView } from 'react-native-vlc';
import type { CoveClient } from '../api/cove';

/**
 * Windows: nothing to bind. libVLC and images load bare URLs, so media URLs carry the current JWT (CoveClient's
 * mediaAuth). A URL made before a renewal stops working once that token expires (15 minutes): seeking late in a long
 * video can be refused.
 */
export function bindMediaAuth(_client: CoveClient): () => void {
  return () => {};
}

export { prefetchMedia } from 'react-native-vlc';

export type {
  VlcVideoViewHandle as VideoViewHandle,
  LoadEvent,
} from 'react-native-vlc';

/** The video player: libVLC, on Windows and Android. */
export const VideoView = VlcVideoView;

export const playerEngine = 'VLC';
