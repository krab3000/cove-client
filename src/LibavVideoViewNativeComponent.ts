import {
  codegenNativeComponent,
  type CodegenTypes,
  type ViewProps,
} from 'react-native';

export type LoadEvent = Readonly<{
  duration: CodegenTypes.Double;
  width: CodegenTypes.Int32;
  height: CodegenTypes.Int32;
  hasAudio: boolean;
  hwDecoding: boolean;
  codec: string;
}>;

export type ProgressEvent = Readonly<{
  currentTime: CodegenTypes.Double;
  duration: CodegenTypes.Double;
}>;

export type ErrorEvent = Readonly<{
  message: string;
}>;

export interface NativeProps extends ViewProps {
  /** A file path or any URL libavformat can open (file:, http(s):, rtsp:, ...). */
  source?: string;
  paused?: CodegenTypes.WithDefault<boolean, false>;
  muted?: CodegenTypes.WithDefault<boolean, false>;
  /** 0..1 */
  volume?: CodegenTypes.WithDefault<CodegenTypes.Float, 1.0>;
  loop?: CodegenTypes.WithDefault<boolean, false>;
  /** Set to false to force software decoding (frames are still rendered on the GPU). */
  hardwareDecoding?: CodegenTypes.WithDefault<boolean, true>;
  onLoad?: CodegenTypes.DirectEventHandler<LoadEvent>;
  onProgress?: CodegenTypes.DirectEventHandler<ProgressEvent>;
  onEnd?: CodegenTypes.DirectEventHandler<null>;
  onError?: CodegenTypes.DirectEventHandler<ErrorEvent>;
}

export default codegenNativeComponent<NativeProps>('LibavVideoView');
