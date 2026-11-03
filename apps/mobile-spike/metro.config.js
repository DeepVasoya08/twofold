// Expo's Metro setup already watches the pnpm workspace; the spike also bundles its model
// inputs (.bin) and the face model (.onnx) as assets.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('onnx', 'bin');

module.exports = config;
