import { createElement, type ComponentType } from 'react';
import {
  clearHttpCache,
  configureHttpCache,
  defaultEngine,
  getDebugProperty,
  LibavVideoView,
  mpvAvailable,
  prefetchMedia as libavPrefetchMedia,
  onHttpAuthorizationNeeded,
  setHttpAuthorization,
  type LibavVideoViewProps,
} from 'react-native-libav';
import {
  clearHttpCache as vlcClearHttpCache,
  onHttpAuthorizationNeeded as vlcOnHttpAuthorizationNeeded,
  prefetchMedia as vlcPrefetchMedia,
  setHttpAuthorization as vlcSetHttpAuthorization,
  VlcVideoView,
} from 'react-native-vlc';
import { setMediaUrlTokens, type CoveClient } from '../api/cove';

/**
 * The A/B engine switch, debug builds only: adb shell setprop debug.libav.player vlc|mpv, then restart Cove.
 *   vlc  react-native-vlc (react-native.config.js links libVLC into debug APKs)
 *   mpv  react-native-libav's view with its engine "mpv" (debug builds ship libmpv), on the same cache as libav
 * libVLC streams through react-native-vlc's byte cache, which sends the header; with that cache off
 * (debug.libav.vlc_cache off) libVLC loads bare URLs: they carry the JWT.
 */
const USE_VLC = __DEV__ && getDebugProperty('player') === 'vlc';
// A build made with mpv as its engine (-PlibavEngine=mpv: release builds too) plays with it unless the switch says
// otherwise.
const USE_MPV =
  !USE_VLC &&
  mpvAvailable() &&
  (__DEV__ && getDebugProperty('player')
    ? getDebugProperty('player') === 'mpv'
    : defaultEngine() === 'mpv');
if (USE_VLC && getDebugProperty('vlc_cache') === 'off') setMediaUrlTokens(true);

/**
 * Media requests to the session's server (the player, preview downloads, images through MainApplication's OkHttp
 * interceptor) carry its access JWT as an Authorization header, set again on every renewal; a request the server
 * refuses (the token ran out while the app slept) renews it. Returns the function that unbinds it (log out).
 */
export function bindMediaAuth(client: CoveClient): () => void {
  const setAuthorization = USE_VLC
    ? (server: string, value: string | null) => {
        setHttpAuthorization(server, value); // images
        vlcSetHttpAuthorization(server, value);
      }
    : setHttpAuthorization;
  const unlisten = client.onAccessToken((token) =>
    setAuthorization(client.server, `Bearer ${token}`)
  );
  const renew = () => {
    client.renew().catch(() => {});
  };
  const unsubscribe = onHttpAuthorizationNeeded(renew);
  const vlcUnsubscribe = USE_VLC ? vlcOnHttpAuthorizationNeeded(renew) : null;
  return () => {
    unlisten();
    unsubscribe();
    vlcUnsubscribe?.();
    setAuthorization(client.server, null);
    // Signed out: the session's media must not stay on the device.
    clearHttpCache();
    if (USE_VLC) vlcClearHttpCache();
  };
}

export const prefetchMedia = USE_VLC ? vlcPrefetchMedia : libavPrefetchMedia;

// Streaming: Cove's videos are read in 1 MB range requests and kept in libav's HTTP cache: a RAM tier sized from the
// device's memory (16 MB on a 4 GB tablet) and a disk tier in the app's cache directory (up to 512 MB) that survives
// restarts, so a video reopened later starts from disk.
configureHttpCache({ chunkSize: 1 << 20 });

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

/** LibavVideoView playing with libmpv. */
function MpvVideoView(props: LibavVideoViewProps) {
  return createElement(LibavVideoView, { ...props, engine: 'mpv' });
}

/** The video player on Android: libav (FFmpeg, MediaCodec). Windows keeps libVLC (player.ts). */
export const VideoView = (
  USE_VLC ? VlcVideoView : USE_MPV ? MpvVideoView : LibavVideoView
) as ComponentType<LibavVideoViewProps & VlcOnlyProps>;

export const playerEngine = USE_VLC ? 'VLC' : USE_MPV ? 'mpv' : 'libav';
