import { useImperativeHandle, useRef, type Ref } from 'react';
import { NativeModules, Platform, type HostInstance } from 'react-native';
import NativeVlcVideoView, {
  Commands,
  type NativeProps,
} from './VlcVideoViewNativeComponent';

export type {
  NativeProps as VlcVideoViewNativeProps,
  AudioTrack,
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
  if (Platform.OS === 'android' && urls.length) NativeModules.VlcCache?.prefetch(urls);
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
        if (nativeRef.current) Commands.seek(nativeRef.current as never, seconds);
      },
    }),
    []
  );
  return <NativeVlcVideoView {...props} ref={nativeRef} />;
}
