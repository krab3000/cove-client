import type { ComponentType } from 'react';
import {
  clearHttpCache,
  configureHttpCache,
  MpvVideoView,
  onHttpAuthorizationNeeded,
  setHttpAuthorization,
  type MpvVideoViewProps,
} from 'react-native-mpv';
import type { CoveClient } from '../api/cove';

/**
 * Media requests to the session's server (the player, preview downloads, images through MainApplication's OkHttp
 * interceptor) carry its access JWT as an Authorization header, set again on every renewal; a request the server
 * refuses (the token ran out while the app slept) renews it. Returns the function that unbinds it (log out).
 */
export function bindMediaAuth(client: CoveClient): () => void {
  const unlisten = client.onAccessToken((token) =>
    setHttpAuthorization(client.server, `Bearer ${token}`)
  );
  const unsubscribe = onHttpAuthorizationNeeded(() => {
    client.renew().catch(() => {});
  });
  return () => {
    unlisten();
    unsubscribe();
    setHttpAuthorization(client.server, null);
    clearHttpCache(); // signed out: the session's media must not stay on the device
  };
}

export { prefetchMedia } from 'react-native-mpv';

// Streaming: Cove's videos are read in 1 MB range requests and kept in react-native-mpv's HTTP cache: a RAM tier sized
// from the device's memory (16 MB on a 4 GB tablet) and a disk tier in the app's cache directory (up to 512 MB) that
// survives restarts, so a video reopened later starts from disk.
configureHttpCache({ chunkSize: 1 << 20 });

export type {
  MpvVideoViewHandle as VideoViewHandle,
  LoadEvent,
} from 'react-native-mpv';

/** The video player on Android: mpv (libmpv; MediaCodec where it can, software decoding otherwise). */
export const VideoView: ComponentType<MpvVideoViewProps> = MpvVideoView;

export const playerEngine = 'mpv';
