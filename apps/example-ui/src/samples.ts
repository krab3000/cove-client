import { Platform } from 'react-native';

// Test clips made by scripts/make-test-media.ps1 (repo root). On Android, scripts/push-test-media.ps1 copies them
// to the example app's external files folder, which the app can read without storage permissions.
const MEDIA = Platform.select({
  android: '/sdcard/Android/data/com.libav.example/files/media',
  default: 'D:/dev/cove/react-native-libav/media',
});

export const SAMPLES = [
  `${MEDIA}/h264-1080p.mp4`,
  `${MEDIA}/hevc10-2160p.mp4`,
  `${MEDIA}/av1-1080p.mkv`,
  `${MEDIA}/multi-audio.mkv`,
];
