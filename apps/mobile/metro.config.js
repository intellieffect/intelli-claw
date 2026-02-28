const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Force single React instance across monorepo
const mobileReact = path.resolve(__dirname, "node_modules/react");
const mobileReactNative = path.resolve(__dirname, "node_modules/react-native");

config.resolver.extraNodeModules = {
  react: mobileReact,
  "react-native": mobileReactNative,
};

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../../node_modules"),
];

module.exports = withNativeWind(config, { input: "./global.css" });
