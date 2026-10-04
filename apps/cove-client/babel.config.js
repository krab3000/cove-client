const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../../packages/react-native-libav/package.json');

// Compiles the library from source (its "react-native-libav-source" export), like the published build would.
module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
  },
  { root: path.resolve(__dirname, '../../packages/react-native-libav'), pkg }
);
