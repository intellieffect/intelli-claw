const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Force single React instance across monorepo (prevents "Invalid hook call" errors)
const mobileReact = path.resolve(__dirname, "node_modules/react");
const mobileReactNative = path.resolve(__dirname, "node_modules/react-native");

config.resolver.extraNodeModules = {
  react: mobileReact,
  "react-native": mobileReactNative,
};

// Ensure Metro resolves from mobile's node_modules first
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../../node_modules"),
];

module.exports = config;
