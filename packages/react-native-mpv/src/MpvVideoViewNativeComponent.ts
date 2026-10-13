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

export type SubtitleTrack = Readonly<{
  /** Stream index in the file: pass it as the subtitleTrack prop to show this track. */
  index: CodegenTypes.Int32;
  language: string;
  title: string;
  /** subrip, ass, mov_text, hdmv_pgs_subtitle, dvd_subtitle, ... */
  codec: string;
  /** The file marks it as the default track. */
  isDefault: boolean;
  forced: boolean;
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
  subtitleTracks: {
    index: CodegenTypes.Int32;
    language: string;
    title: string;
    codec: string;
    isDefault: boolean;
    forced: boolean;
  }[];
  /** Index of the subtitle track shown, -1 when none is. */
  subtitleTrack: CodegenTypes.Int32;
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
  /**
   * A file path, a content:// URI or a URL. http(s) sources are read through the package's RAM/disk cache
   * (configureHttpCache); other URLs as mpv opens them.
   */
  source?: string;
  paused?: CodegenTypes.WithDefault<boolean, false>;
  muted?: CodegenTypes.WithDefault<boolean, false>;
  /** 0..1 */
  volume?: CodegenTypes.WithDefault<CodegenTypes.Float, 1.0>;
  loop?: CodegenTypes.WithDefault<boolean, false>;
  /**
   * Set to false to force software decoding. With it (the default), mpv decodes with MediaCodec where it can for the
   * codec and in software otherwise; frames are drawn with OpenGL ES either way.
   */
  hardwareDecoding?: CodegenTypes.WithDefault<boolean, true>;
  /**
   * Verify the server's TLS certificate for https sources (default true). Set false only for a server whose
   * certificate the app has validated itself (e.g. one with a private CA).
   */
  tlsVerify?: CodegenTypes.WithDefault<boolean, true>;
  /** Audio stream to play (an index from onLoad's audioTracks); -1 picks the default track. */
  audioTrack?: CodegenTypes.WithDefault<CodegenTypes.Int32, -1>;
  /**
   * Subtitle stream to show (an index from onLoad's subtitleTracks); -1: the file's default track (as mpv picks it:
   * the default or forced one, if any), -2: none. Drawn into the video by mpv (libass).
   */
  subtitleTrack?: CodegenTypes.WithDefault<CodegenTypes.Int32, -1>;
  /**
   * Download the whole http(s) source into the app's cache first and play the local file (streams it if the
   * download fails). For small files such as preview clips, which then start much sooner (no streaming round trips,
   * no network buffer); see prefetchMedia. `adb logcat -s MpvCache` tells whether a source played from the cache,
   * was downloaded first, or streamed.
   */
  cache?: CodegenTypes.WithDefault<boolean, false>;
  /** Playback speed (1 = normal). */
  rate?: CodegenTypes.WithDefault<CodegenTypes.Float, 1.0>;
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
  'MpvVideoView'
) as NativeComponentType;
