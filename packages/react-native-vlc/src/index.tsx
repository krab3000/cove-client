import { useImperativeHandle, useRef, type Ref } from 'react';
import {
  DeviceEventEmitter,
  NativeModules,
  Platform,
  type HostInstance,
} from 'react-native';
import NativeVlcVideoView, {
  Commands,
  type NativeProps,
} from './VlcVideoViewNativeComponent';

export type {
  NativeProps as VlcVideoViewNativeProps,
  AudioTrack,
  SubtitleTrack,
  LoadEvent,
  ProgressEvent,
  SeekEvent,
  ErrorEvent,
} from './VlcVideoViewNativeComponent';

/**
 * Android: downloads media into the cache a VlcVideoView with `cache` plays from, ahead of time (preview clips of
 * the cards around the one previewing, say). Does nothing elsewhere.
 */
export function prefetchMedia(urls: string[]): void {
  if (Platform.OS === 'android' && urls.length)
    NativeModules.VlcCache?.prefetch(urls);
}

/**
 * Android: the byte cache http(s) streams play through (a loopback proxy, android/.../StreamProxy, in front of
 * HttpChunkCache): read in chunks of chunkSize bytes (default 1 MB), each from RAM, else from the disk tier, else
 * downloaded with one Range request and kept in both; the disk tier persists across launches.
 * - chunkSize: bytes per range request and cache entry
 * - memorySize: the RAM tier (default: from device RAM, 8-64 MB)
 * - diskSize: the disk tier (default 512 MB, less if the system's cache quota is), 0 for none
 * - diskDir: the disk tier's directory (default: the app's cache directory/rnvlc-http)
 * Unset options are derived from the device. Does nothing elsewhere.
 */
export function configureHttpCache({
  chunkSize,
  memorySize,
  diskSize,
  diskDir,
}: {
  chunkSize?: number;
  memorySize?: number;
  diskSize?: number;
  diskDir?: string;
}): void {
  if (Platform.OS !== 'android') return;
  NativeModules.VlcCache?.configureHttp(
    chunkSize ?? -1,
    memorySize ?? -1,
    diskSize ?? -1,
    diskDir ?? null
  );
}

/** Android: empties the byte cache's RAM and disk tiers (e.g. on sign-out). Does nothing elsewhere. */
export function clearHttpCache(): void {
  if (Platform.OS === 'android') NativeModules.VlcCache?.clearHttpCache();
}

export type HttpCacheStats = {
  chunkSize: number;
  ramBytes: number;
  ramLimit: number;
  diskBytes: number;
  diskLimit: number;
  ramHits: number;
  diskHits: number;
  fetches: number;
  fetchedBytes: number;
};

/** Android: what the byte cache holds and has done; null elsewhere. */
export async function getHttpCacheStats(): Promise<HttpCacheStats | null> {
  if (Platform.OS !== 'android' || !NativeModules.VlcCache) return null;
  return JSON.parse(await NativeModules.VlcCache.getHttpCacheStats());
}

/**
 * Android: the Authorization header (e.g. `Bearer <jwt>`) for a server's media requests: streams (through the byte
 * cache) and preview downloads (prefetchMedia, `cache`). Set it again whenever the token renews; null removes it.
 * Media URLs then need no token in them. Does nothing elsewhere (libVLC loads bare URLs there).
 */
export function setHttpAuthorization(
  server: string,
  value: string | null
): void {
  if (Platform.OS === 'android')
    NativeModules.VlcCache?.setHttpAuthorization(server, value);
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
    'VlcAuthRequired',
    listener
  );
  return () => subscription.remove();
}

export type VlcVideoViewHandle = {
  /** Seeks to a time in seconds from the start (frame accurate); onSeek fires once that frame is shown. */
  seek: (seconds: number) => void;
};

export type VlcVideoViewProps = NativeProps & {
  ref?: Ref<VlcVideoViewHandle>;
};

export function VlcVideoView({ ref, ...props }: VlcVideoViewProps) {
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
  return <NativeVlcVideoView {...props} ref={nativeRef} />;
}
