import { Platform } from 'react-native';
import { LibavVideoView } from 'react-native-libav';
import { VlcVideoView } from 'react-native-vlc';

export type {
  LibavVideoViewHandle as VideoViewHandle,
  LoadEvent,
} from 'react-native-libav';

/**
 * The video player: libVLC on Windows, react-native-libav on Android (until react-native-vlc has an Android
 * side). Both components take the same props and events and have the same seek() handle.
 */
export const VideoView: typeof LibavVideoView =
  Platform.OS === 'windows' ? VlcVideoView : LibavVideoView;

export const playerEngine = Platform.OS === 'windows' ? 'VLC' : 'libav';
