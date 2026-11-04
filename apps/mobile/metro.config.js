// Expo's Metro setup already watches the pnpm workspace, so the shared packages bundle as
// they are.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
