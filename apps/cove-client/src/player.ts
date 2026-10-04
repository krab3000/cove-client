import { VlcVideoView } from 'react-native-vlc';

export type {
  VlcVideoViewHandle as VideoViewHandle,
  LoadEvent,
} from 'react-native-vlc';

/** The video player: libVLC, on Windows and Android. */
export const VideoView = VlcVideoView;

export const playerEngine = 'VLC';
