import type { ComponentType } from 'react';
import {
  clearHttpCache,
  configureHttpCache,
  MpvVideoView,
  onHttpAuthorizationNeeded,
  setDebugProperty,
  setHttpAuthorization,
  type MpvVideoViewProps,
} from 'react-native-mpv';
import { subscribe } from 'valtio';
import type { CoveClient } from '../api/cove';
import { PREF_DEFAULTS, prefs, type Prefs } from '../state/prefs';

/**
 * Media requests to the session's server (the player, preview downloads; on Android also images, through
 * MainApplication's OkHttp interceptor) carry its access JWT as an Authorization header, set again on every renewal;
 * a request the server refuses (the token ran out while the app slept) renews it. Returns the function that unbinds
 * it (log out).
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

export {
  prefetchMedia,
  prepareMedia,
  clearHttpCache,
  getHttpCacheStats,
  type HttpCacheStats,
} from 'react-native-mpv';

// Streaming: Cove's videos are read in 1 MB range requests and kept in react-native-mpv's HTTP cache: a RAM tier sized
// from the device's memory (16 MB on a 4 GB tablet) and a disk tier in the app's cache directory (up to 512 MB) that
// survives restarts, so a video reopened later starts from disk. Settings (Streaming & cache) can change each.
configureHttpCache({ chunkSize: 1 << 20 });

const MB = 1 << 20;

/**
 * The device's settings the player stack reads (the cache's sizes, the debug switches behind Diagnostics), applied
 * now and whenever they change. A switch at its default is left unset, so a developer's adb setprop / MPV_* still
 * applies. Once, after the settings are read.
 */
export function followPlayerPrefs() {
  let applied = '';
  const apply = () => {
    const p = prefs;
    const key = [
      p.memoryCacheMB,
      p.diskCacheMB,
      p.chunkKB,
      p.readAhead,
      p.wifiLock,
      p.stats,
      p.playerLog,
      p.networkLog,
    ].join(' ');
    if (key === applied) return;
    applied = key;
    configureHttpCache({
      chunkSize: p.chunkKB * 1024,
      memorySize: p.memoryCacheMB < 0 ? undefined : p.memoryCacheMB * MB,
      diskSize: p.diskCacheMB < 0 ? undefined : p.diskCacheMB * MB,
    });
    const unlessDefault = (name: keyof Prefs, value: string) =>
      p[name] === PREF_DEFAULTS[name] ? null : value;
    setDebugProperty(
      'read_ahead',
      unlessDefault('readAhead', String(p.readAhead))
    );
    setDebugProperty('wifi_lock', unlessDefault('wifiLock', '0'));
    setDebugProperty('stats', unlessDefault('stats', '1'));
    setDebugProperty('log', unlessDefault('playerLog', p.playerLog));
    setDebugProperty('http_log', unlessDefault('networkLog', '1'));
  };
  apply();
  subscribe(prefs, apply);
}

export type {
  MpvVideoViewHandle as VideoViewHandle,
  LoadEvent,
} from 'react-native-mpv';

/**
 * The video player: mpv (libmpv), on Android (MediaCodec where it can, software decoding otherwise) and Windows
 * (D3D11VA where it can, software decoding otherwise).
 */
export const VideoView: ComponentType<MpvVideoViewProps> = MpvVideoView;

export const playerEngine = 'mpv';
