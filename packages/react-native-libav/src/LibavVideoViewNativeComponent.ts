import type * as React from 'react';
import {
  codegenNativeCommands,
  codegenNativeComponent,
  type CodegenTypes,
  type HostComponent,
  type ViewProps,
} from 'react-native';

export type AudioTrack = Readonly<{
  /** Stream index in the file: pass it as the audioTrack prop to select this track. */
  index: CodegenTypes.Int32;
  language: string;
  title: string;
  codec: string;
  channels: CodegenTypes.Int32;
  sampleRate: CodegenTypes.Int32;
}>;

export type LoadEvent = Readonly<{
  duration: CodegenTypes.Double;
  width: CodegenTypes.Int32;
  height: CodegenTypes.Int32;
  hasAudio: boolean;
  hwDecoding: boolean;
  codec: string;
  audioTracks: {
    index: CodegenTypes.Int32;
    language: string;
    title: string;
    codec: string;
    channels: CodegenTypes.Int32;
    sampleRate: CodegenTypes.Int32;
  }[];
  /** Index of the audio track playing, -1 when there is none. */
  audioTrack: CodegenTypes.Int32;
}>;

export type ProgressEvent = Readonly<{
  currentTime: CodegenTypes.Double;
  duration: CodegenTypes.Double;
}>;

export type SeekEvent = Readonly<{
  currentTime: CodegenTypes.Double;
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
  /**
   * Verify the server's TLS certificate for https sources (default true). Set false only for a server whose
   * certificate the app has validated itself, e.g. when FFmpeg's stricter check fails behind TLS-inspecting
   * antivirus whose CA publishes no revocation list.
   */
  tlsVerify?: CodegenTypes.WithDefault<boolean, true>;
  /** Audio stream to play (an index from onLoad's audioTracks); -1 picks the default track. */
  audioTrack?: CodegenTypes.WithDefault<CodegenTypes.Int32, -1>;
  /**
   * Android: download the whole http(s) source into the app's cache first and play the local file (streams it if
   * the download fails). For small files such as preview clips, which then start much sooner (no streaming round
   * trips, no network buffer); see prefetchMedia. `adb logcat -s LibavCache` tells whether a source played from
   * the cache, was downloaded first, or streamed. Ignored on Windows.
   */
  cache?: CodegenTypes.WithDefault<boolean, false>;
  /**
   * FFmpeg options for opening the source, "key=value:key=value": the demuxer's (probesize, analyzeduration,
   * interleaved_read, ...) and the protocol's (multiple_requests, short_seek_size, ...); async=1 adds a read-ahead
   * thread for http(s). Changing it reopens the source. Android: the system property debug.libav.input_opts is
   * added for http(s) sources and wins (for trying options without a rebuild). Ignored on Windows.
   */
  inputOptions?: string;
  /**
   * The engine: 'libav' (the default: this package's FFmpeg player) or 'mpv' (libmpv, where the build has it: debug
   * builds; elsewhere libav plays). Both read http(s) sources through the same RAM/disk cache. Reopens the source.
   */
  engine?: string;
  onLoad?: CodegenTypes.DirectEventHandler<LoadEvent>;
  onProgress?: CodegenTypes.DirectEventHandler<ProgressEvent>;
  /** A seek finished: the frame at currentTime is on screen. */
  onSeek?: CodegenTypes.DirectEventHandler<SeekEvent>;
  onEnd?: CodegenTypes.DirectEventHandler<null>;
  onError?: CodegenTypes.DirectEventHandler<ErrorEvent>;
}

export type NativeComponentType = HostComponent<NativeProps>;

interface NativeCommands {
  seek: (
    viewRef: React.ElementRef<NativeComponentType>,
    time: CodegenTypes.Double
  ) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['seek'],
});

export default codegenNativeComponent<NativeProps>(
  'LibavVideoView'
) as NativeComponentType;
