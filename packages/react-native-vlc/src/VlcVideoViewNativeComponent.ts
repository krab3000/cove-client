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
  /** Subtitle tracks: the file's, and subtitle files beside a local file (movie.srt for movie.mkv). */
  subtitleTracks: {
    index: CodegenTypes.Int32;
    language: string;
    title: string;
    codec: string;
  }[];
  /** Index of the subtitle track shown, -1 when none is. */
  subtitleTrack: CodegenTypes.Int32;
}>;

export type SubtitleTrack = Readonly<{
  /** Position in onLoad's subtitleTracks: pass it as the subtitleTrack prop to show this track. */
  index: CodegenTypes.Int32;
  language: string;
  title: string;
  codec: string;
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
   * Subtitle track to show (an index from onLoad's subtitleTracks); -1 keeps VLC's choice (a track the file marks
   * as default, else none), -2 shows none. (Android: subtitles are not rendered, see VlcVideoView.kt.)
   */
  subtitleTrack?: CodegenTypes.WithDefault<CodegenTypes.Int32, -1>;
  /**
   * Android: show the video through a hardware overlay (a SurfaceView), the cheapest way for a large or
   * full-screen player (no GPU copy of every frame). The view is then opaque and ignores opacity; leave it false
   * for small players that should stay transparent until their first frame (previews). Ignored on Windows.
   */
  overlay?: CodegenTypes.WithDefault<boolean, false>;
  /**
   * Android: download the whole http(s) source into the app's cache first and play the local file (streams it
   * if the download fails). For small files such as preview clips, which then start much sooner (no streaming
   * round trips, no network buffer); see prefetchMedia. A cached source opened muted plays without audio (it
   * starts sooner; unmuting it stays silent). Windows streams the source (no download), but a cached source opened
   * muted plays without audio there too.
   */
  cache?: CodegenTypes.WithDefault<boolean, false>;
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
  'VlcVideoView'
) as NativeComponentType;
