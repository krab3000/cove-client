import { useImperativeHandle, useRef, type Ref } from 'react';
import {
  DeviceEventEmitter,
  NativeModules,
  Platform,
  type HostInstance,
} from 'react-native';
import NativeLibavVideoView, {
  Commands,
  type NativeProps,
} from './LibavVideoViewNativeComponent';

export type {
  NativeProps as LibavVideoViewNativeProps,
  AudioTrack,
  LoadEvent,
  ProgressEvent,
  SeekEvent,
  ErrorEvent,
} from './LibavVideoViewNativeComponent';

/** Android: the engine the build was made for: 'mpv' (built with -PlibavEngine=mpv) or 'libav'. */
export function defaultEngine(): 'libav' | 'mpv' {
  if (Platform.OS !== 'android') return 'libav';
  return NativeModules.LibavCache?.getDefaultEngine() === 'mpv'
    ? 'mpv'
    : 'libav';
}

/** Android: whether LibavVideoView's engine 'mpv' is in this build (debug builds); false elsewhere. */
export function mpvAvailable(): boolean {
  if (Platform.OS !== 'android') return false;
  return NativeModules.LibavCache?.isMpvAvailable() ?? false;
}

/**
 * The debug switch debug.libav.<name> (adb shell setprop debug.libav.<name> <value>), '' when unset or off Android.
 * Synchronous: read once at startup, not per frame.
 */
export function getDebugProperty(name: string): string {
  if (Platform.OS !== 'android') return '';
  return NativeModules.LibavCache?.getDebugProperty(name) ?? '';
}

/**
 * Android: downloads media into the cache a LibavVideoView with `cache` plays from, ahead of time (preview clips of
 * the cards around the one previewing, say). Does nothing elsewhere.
 */
export function prefetchMedia(urls: string[]): void {
  if (Platform.OS === 'android' && urls.length)
    NativeModules.LibavCache?.prefetch(urls);
}

/**
 * Android: the HTTP cache http(s) sources play through (C++, cpp/HttpCache). Each read is served from a chunk of
 * chunkSize bytes (default 1 MB), from RAM, else from the disk tier, else downloaded with one Range request and kept
 * in both. The disk tier persists across launches, so a video reopened later starts from disk.
 * - chunkSize: bytes per range request and cache entry
 * - memorySize: the RAM tier (default: from device RAM, 8-64 MB: a 4 GB device gets 16 MB)
 * - diskSize: the disk tier (default 512 MB, never more than half the free space), 0 for none
 * - diskDir: the disk tier's directory (default: the app's cache directory/libav-http)
 * - maxSize: deprecated, taken as memorySize
 * Unset options are derived from the device. Does nothing elsewhere yet.
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
  if (Platform.OS !== 'android') return;
  const memory = memorySize ?? maxSize;
  NativeModules.LibavCache?.configureHttp(
    chunkSize ?? -1,
    memory ?? -1,
    diskSize ?? -1,
    diskDir ?? null
  );
}

/** Android: empties the HTTP cache's RAM and disk tiers (e.g. on sign-out). Does nothing elsewhere yet. */
export function clearHttpCache(): void {
  if (Platform.OS === 'android') NativeModules.LibavCache?.clearHttpCache();
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

/** Android: what the HTTP cache holds and has done; null elsewhere. */
export async function getHttpCacheStats(): Promise<HttpCacheStats | null> {
  if (Platform.OS !== 'android' || !NativeModules.LibavCache) return null;
  return JSON.parse(await NativeModules.LibavCache.getHttpCacheStats());
}

/**
 * Android: the Authorization header (e.g. `Bearer <jwt>`) for a server's media requests: the player's, preview
 * downloads (prefetchMedia, `cache`), and images, when the app installs HttpAuth's OkHttp interceptor. Set it again
 * whenever the token renews; null removes it. Media URLs then need no token in them. Does nothing elsewhere.
 */
export function setHttpAuthorization(
  server: string,
  value: string | null
): void {
  if (Platform.OS === 'android')
    NativeModules.LibavCache?.setHttpAuthorization(server, value);
}

/**
 * Android: called with a server (scheme://host:port) when it refused the header (401): renew the token and set it
 * again with setHttpAuthorization; the refused requests wait a moment for it and are retried. Returns the
 * unsubscribe function.
 */
export function onHttpAuthorizationNeeded(
  listener: (server: string) => void
): () => void {
  if (Platform.OS !== 'android') return () => {};
  const subscription = DeviceEventEmitter.addListener(
    'LibavAuthRequired',
    listener
  );
  return () => subscription.remove();
}

export type LibavVideoViewHandle = {
  /** Seeks to a time in seconds from the start (frame accurate); onSeek fires once that frame is shown. */
  seek: (seconds: number) => void;
};

export type LibavVideoViewProps = NativeProps & {
  ref?: Ref<LibavVideoViewHandle>;
};

export function LibavVideoView({ ref, ...props }: LibavVideoViewProps) {
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
  return <NativeLibavVideoView {...props} ref={nativeRef} />;
}
