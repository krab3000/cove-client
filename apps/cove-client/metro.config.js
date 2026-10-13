const fs = require('fs');
const path = require('path');
const { getDefaultConfig } = require('@react-native/metro-config');
const { withMetroConfig } = require('react-native-monorepo-config');

const root = path.resolve(__dirname, '../..');
const library = path.join(root, 'packages', 'react-native-mpv');
const rnwPath = fs.realpathSync(
  path.dirname(require.resolve('react-native-windows/package.json'))
);

// A regex for everything under dir, whichever slashes the path uses.
const under = (dir) =>
  new RegExp(
    `^${dir
      .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
      .replace(/\\\\|\//g, '[\\\\/]')}[\\\\/].*$`
  );

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = withMetroConfig(getDefaultConfig(__dirname), {
  root,
  dirname: __dirname,
  conditions: ['react-native-mpv-source'],
});

// Keep Metro out of the native build trees: run-windows would otherwise crash a running Metro, or hit EBUSY on
// files MSBuild holds open.
const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  under(path.resolve(__dirname, 'windows')),
  under(path.resolve(__dirname, 'android')),
  under(path.join(library, 'android')),
  under(path.join(library, 'third_party')),
  under(path.join(root, 'apps', 'mpv-test', 'android')),
  under(path.join(rnwPath, 'build')),
  under(path.join(rnwPath, 'target')),
  /.*\.ProjectImports\.zip/,
];

module.exports = config;
