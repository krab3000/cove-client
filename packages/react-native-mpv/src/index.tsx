import { useImperativeHandle, useRef, type Ref } from 'react';
import {
  DeviceEventEmitter,
  NativeModules,
  Platform,
  type HostInstance,
} from 'react-native';
import NativeMpvVideoView, {
  Commands,
  type NativeProps,
} from './MpvVideoViewNativeComponent';

export type {
  NativeProps as MpvVideoViewNativeProps,
  AudioTrack,
  SubtitleTrack,
  LoadEvent,
  ProgressEvent,
  SeekEvent,
  ErrorEvent,
} from './MpvVideoViewNativeComponent';

/** Where the native side exists: Android and Windows. */
const NATIVE = Platform.OS === 'android' || Platform.OS === 'windows';

/**
 * The debug switch <name>, '' when unset: Android: debug.mpv.<name> (adb shell setprop debug.mpv.<name> <value>);
 * Windows: the environment variable MPV_<NAME>. Synchronous: read once at startup, not per frame.
 */
export function getDebugProperty(name: string): string {
  if (!NATIVE) return '';
  return NativeModules.MpvCache?.getDebugProperty(name) ?? '';
}

/**
 * Sets the debug switch <name> for this process, over the system's (Android's property, Windows' environment
 * variable): an app's own settings for what the switches control (log, stats, read_ahead, http_log; Android:
 * wifi_lock, 0 for no Wi-Fi lock while streaming). null or '' unsets it, so the system's applies again. The player
 * reads them when it opens a source. Does nothing off Android and Windows.
 */
export function setDebugProperty(name: string, value: string | null): void {
  if (NATIVE) NativeModules.MpvCache?.setDebugProperty(name, value);
}

/**
 * Loads media ahead of time (preview clips of the cards around the one previewing, say). Android: downloads it into
 * the cache a MpvVideoView with `cache` plays from; Windows: reads its start into the HTTP cache. Does nothing
 * elsewhere.
 */
export function prefetchMedia(urls: string[]): void {
  if (NATIVE && urls.length) NativeModules.MpvCache?.prefetch(urls);
}

/**
 * Android and Windows: the HTTP cache http(s) sources play through (C++, cpp/HttpCache). Each read is served from a chunk of
 * chunkSize bytes (default 1 MB), from RAM, else from the disk tier, else downloaded with one Range request and kept
 * in both. The disk tier persists across launches, so a video reopened later starts from disk.
 * - chunkSize: bytes per range request and cache entry
 * - memorySize: the RAM tier (default: from device RAM, 8-64 MB: a 4 GB device gets 16 MB)
 * - diskSize: the disk tier (default 512 MB, never more than half the free space), 0 for none
 * - diskDir: the disk tier's directory (default: the app's cache directory/mpv-http; Windows: the package's
 *   LocalCache\mpv-http, %TEMP%\mpv-http unpackaged)
 * - maxSize: deprecated, taken as memorySize
 * Unset options are derived from the device. Does nothing elsewhere.
 */
export function configureHttpCache({
  chunkSize,
  memorySize,
  diskSize,
  diskDir,
  maxSize,
}: {
  chunkSize?: number;
  memorySize?: number;
  diskSize?: number;
  diskDir?: string;
  maxSize?: number;
}): void {
  if (!NATIVE) return;
  const memory = memorySize ?? maxSize;
  NativeModules.MpvCache?.configureHttp(
    chunkSize ?? -1,
    memory ?? -1,
    diskSize ?? -1,
    diskDir ?? null
  );
}

/** Empties the HTTP cache's RAM and disk tiers (e.g. on sign-out). Does nothing off Android and Windows. */
export function clearHttpCache(): void {
  if (NATIVE) NativeModules.MpvCache?.clearHttpCache();
}

export type HttpCacheStats = {
  chunkSize: number;
  ramBytes: number;
  ramLimit: number;
  ramChunks: number;
  liveChunkBytes: number;
  fetches: number;
  fetchedBytes: number;
  fetchMs: number;
  failed: number;
  inFlight: number;
  disk: {
    enabled: boolean;
    bytes: number;
    limit: number;
    chunks: number;
    writes: number;
    droppedWrites: number;
    reads: number;
    corrupt: number;
    evicted: number;
  };
};

/** What the HTTP cache holds and has done; null off Android and Windows. */
export async function getHttpCacheStats(): Promise<HttpCacheStats | null> {
  if (!NATIVE || !NativeModules.MpvCache) return null;
  return JSON.parse(await NativeModules.MpvCache.getHttpCacheStats());
}

/**
 * The Authorization header (e.g. `Bearer <jwt>`) for a server's media requests: the player's, preview downloads
 * (prefetchMedia, `cache`), and on Android images, when the app installs HttpAuth's OkHttp interceptor. Set it again
 * whenever the token renews; null removes it. Media URLs then need no token in them. Does nothing off Android and
 * Windows.
 */
export function setHttpAuthorization(
  server: string,
  value: string | null
): void {
  if (NATIVE) NativeModules.MpvCache?.setHttpAuthorization(server, value);
}

/**
 * Android and Windows: called with a server (scheme://host:port) when it refused the header (401): renew the token and set it
 * again with setHttpAuthorization; the refused requests wait a moment for it and are retried. Returns the
 * unsubscribe function.
 */
export function onHttpAuthorizationNeeded(
  listener: (server: string) => void
): () => void {
  if (!NATIVE) return () => {};
  const subscription = DeviceEventEmitter.addListener(
    'MpvAuthRequired',
    listener
  );
  return () => subscription.remove();
}

export type MpvVideoViewHandle = {
  /** Seeks to a time in seconds from the start (frame accurate); onSeek fires once that frame is shown. */
  seek: (seconds: number) => void;
};

export type MpvVideoViewProps = NativeProps & {
  ref?: Ref<MpvVideoViewHandle>;
};

export function MpvVideoView({ ref, ...props }: MpvVideoViewProps) {
  const nativeRef = useRef<HostInstance>(null);
  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds: number) => {
        // The codegen command type wants React.ElementRef<HostComponent>, which TS resolves to never.
        if (nativeRef.current)
          Commands.seek(nativeRef.current as never, seconds);
      },
    }),
    []
  );
  return <NativeMpvVideoView {...props} ref={nativeRef} />;
}
