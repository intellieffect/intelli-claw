import { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "intelli-claw",
  slug: "intelli-claw",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "intelli-claw",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.intellieffect.intelliclaw",
    googleServicesFile: "./GoogleService-Info.plist",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: "QR 코드를 스캔하여 Gateway에 연결하기 위해 카메라 접근이 필요합니다.",
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#ffffff",
    },
    package: "com.intellieffect.intelliclaw",
    googleServicesFile: "./google-services.json",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    "@react-native-firebase/app",
    [
      "expo-camera",
      {
        cameraPermission: "QR 코드를 스캔하여 Gateway에 연결하기 위해 카메라 접근이 필요합니다.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    gatewayUrl: process.env.GATEWAY_URL || "ws://127.0.0.1:18789",
    gatewayToken: process.env.GATEWAY_TOKEN || "",
    gatewayHttpUrl: process.env.GATEWAY_HTTP_URL || "http://127.0.0.1:18789",
    eas: {
      projectId: "32aef4ab-26e8-4f20-b47a-b0f851dac43b",
    },
  },
});
