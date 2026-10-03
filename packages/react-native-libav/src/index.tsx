import { useImperativeHandle, useRef, type Ref } from 'react';
import type { HostInstance } from 'react-native';
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
