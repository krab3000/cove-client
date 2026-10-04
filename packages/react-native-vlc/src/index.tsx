import { useImperativeHandle, useRef, type Ref } from 'react';
import type { HostInstance } from 'react-native';
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
