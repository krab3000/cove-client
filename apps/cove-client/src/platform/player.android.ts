import type { ComponentType } from 'react';
import {
  configureHttpCache,
  LibavVideoView,
  onHttpAuthorizationNeeded,
  setHttpAuthorization,
  type LibavVideoViewProps,
} from 'react-native-libav';
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
  };
}

export { prefetchMedia } from 'react-native-libav';

// Streaming: Cove's video URLs are read in 1 MB range requests through Android's HTTP stack, kept in a 100 MB
// in-memory cache (least recently used first out), so reopening or seeking back in a video reuses what it has.
configureHttpCache({ chunkSize: 1 << 20, maxSize: 100 << 20 });

export type {
  LibavVideoViewHandle as VideoViewHandle,
  LoadEvent,
} from 'react-native-libav';

/**
 * react-native-vlc's props the app passes that libav has no counterpart for. The native view ignores them: rate
 * (playback speed stays 1×), overlay and demux (FFmpeg demuxes everything).
 */
type VlcOnlyProps = {
  rate?: number;
  overlay?: boolean;
  demux?: string;
};

/** The video player on Android: libav (FFmpeg, MediaCodec). Windows keeps libVLC (player.ts). */
export const VideoView = LibavVideoView as ComponentType<
  LibavVideoViewProps & VlcOnlyProps
>;

export const playerEngine = 'libav';
