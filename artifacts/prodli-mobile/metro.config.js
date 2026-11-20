// Metro (the React Native bundler). Expo's defaults already understand pnpm
// workspaces: they watch the repo root, so the app can import the pure,
// shared logic that lives in the extension (artifacts/prodli/src/lib), e.g.
// the sync engine, without copying it. See src/shared/.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
