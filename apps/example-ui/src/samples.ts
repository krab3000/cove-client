import { Platform } from 'react-native';

// Test clips made by scripts/make-test-media.ps1 (repo root). On Android, scripts/push-test-media.ps1 copies them
// into the example app's internal files folder.
const MEDIA = Platform.select({
  android: '/data/user/0/com.libav.example/files/media',
  default: 'D:/dev/cove/react-native-libav/media',
});

// PhotoJoseph's A/V sync test (HEVC 2160p 59.94): a local file, copied to the phone by hand.
const AV_SYNC = Platform.select({
  android: `${MEDIA}/av-sync-hevc-2160p59.mov`,
  default: 'E:/Audio_Video_Sync_59,94_HEVC_2160p-by_PhotoJoseph.mov',
});

export const SAMPLES = [
  `${MEDIA}/h264-1080p.mp4`,
  `${MEDIA}/hevc10-2160p.mp4`,
  `${MEDIA}/av1-1080p.mkv`,
  `${MEDIA}/multi-audio.mkv`,
  AV_SYNC,
];
