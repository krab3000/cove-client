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

/**
 * Android: downloads media into the cache a LibavVideoView with `cache` plays from, ahead of time (preview clips of
 * the cards around the one previewing, say). Does nothing elsewhere.
 */
export function prefetchMedia(urls: string[]): void {
  if (Platform.OS === 'android' && urls.length) NativeModules.LibavCache?.prefetch(urls);
}

/**
 * Android: how http(s) sources are streamed. The player reads them through the platform's HTTP stack and an
 * in-memory cache of byte ranges: each read is served from a chunk of chunkSize bytes (default 1 MB), downloaded
 * with one Range request on a miss; the cache keeps at most maxSize bytes (default 100 MB), least recently used
 * chunks evicted first. Does nothing elsewhere.
 */
export function configureHttpCache({
  chunkSize = 1 << 20,
  maxSize = 100 << 20,
}: {
  chunkSize?: number;
  maxSize?: number;
}): void {
  if (Platform.OS === 'android')
    NativeModules.LibavCache?.configureHttp(chunkSize, maxSize);
}

/**
 * Android: the Authorization header (e.g. `Bearer <jwt>`) for a server's media requests: the player's, preview
 * downloads (prefetchMedia, `cache`), and images, when the app installs HttpAuth's OkHttp interceptor. Set it again
 * whenever the token renews; null removes it. Media URLs then need no token in them. Does nothing elsewhere.
 */
export function setHttpAuthorization(server: string, value: string | null): void {
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
        if (nativeRef.current) Commands.seek(nativeRef.current as never, seconds);
      },
    }),
    []
  );
  return <NativeLibavVideoView {...props} ref={nativeRef} />;
}
