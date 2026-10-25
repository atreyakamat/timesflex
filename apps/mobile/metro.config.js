// The app shares pure logic with the web app from packages/core (outside this folder),
// so Metro must watch it. Packages still resolve only from this app's node_modules,
// keeping React 19 here separate from the web app's React 18.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../packages/core')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
