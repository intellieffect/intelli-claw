import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "iClaw",
  slug: "intelli-claw",
  version: "0.2.35",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "intelli-claw",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.intellieffect.intelliclaw",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#09090b",
    },
    package: "com.intellieffect.intelliclaw",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    [
      "expo-build-properties",
      {
        ios: { useFrameworks: "static" },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: "32aef4ab-26e8-4f20-b47a-b0f851dac43b",
    },
  },
});
