const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const root = path.resolve(__dirname, '../..');
const library = path.join(root, 'packages', 'react-native-mpv');

// A regex for everything under dir, whichever slashes the path uses.
const under = (dir) =>
  new RegExp(
    `^${dir
      .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
      .replace(/\\\\|\//g, '[\\\\/]')}[\\\\/].*$`
  );

/** @type {import('metro-config').MetroConfig} */
const config = withMetroConfig(getDefaultConfig(__dirname), {
  root,
  dirname: __dirname,
  conditions: ['react-native-mpv-source'],
});

// Keep Metro out of the native build trees.
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  under(path.resolve(__dirname, 'android')),
  under(path.join(library, 'android')),
  under(path.join(library, 'third_party')),
  under(path.join(root, 'apps', 'cove-client', 'android')),
  under(path.join(root, 'apps', 'cove-client', 'windows')),
];

module.exports = config;
