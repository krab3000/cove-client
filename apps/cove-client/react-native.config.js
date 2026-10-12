// The player per platform (src/platform/player*.ts): libav on Android, libVLC on Windows.
module.exports = {
  dependencies: {
    'react-native-libav': { platforms: { windows: null } },
    'react-native-vlc': { platforms: { android: null } },
  },
};
