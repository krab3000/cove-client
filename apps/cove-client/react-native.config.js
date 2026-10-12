// The player per platform (src/platform/player*.ts): libav on Android, libVLC on Windows. Android debug builds also
// link libVLC, for the A/B engine switch (adb shell setprop debug.libav.player vlc; see player.android.ts): it adds
// ~30 MB, so release builds leave it out. PackageList ignores buildTypes, hence DebugPackages (src/debug and
// src/release versions) instead of VlcPackage itself.
module.exports = {
  dependencies: {
    'react-native-libav': { platforms: { windows: null } },
    'react-native-vlc': {
      platforms: {
        android: {
          buildTypes: ['debug'],
          packageImportPath: 'import com.cove.client.DebugPackages;',
          packageInstance: 'DebugPackages.vlc()',
        },
      },
    },
  },
};
