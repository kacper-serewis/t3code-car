import type { ExpoConfig } from "expo/config";

import { loadRepoEnv } from "../../scripts/lib/public-config.ts";

const repoEnv = loadRepoEnv();
// Expo's TypeScript setup otherwise installs `typescript` on every start; we typecheck with tsrs.
process.env.EXPO_NO_TYPESCRIPT_SETUP = "1";

// Personal builds sign with their own team and identifier; set these in the repo's `.env.local`.
const bundleIdentifier = repoEnv.T3CAR_IOS_BUNDLE_ID?.trim() || "com.t3tools.t3car";
const appleTeamId = repoEnv.T3CAR_IOS_TEAM_ID?.trim() || undefined;

const MICROPHONE_PURPOSE = "T3 Car listens so you can talk to your agent hands-free.";

const config: ExpoConfig = {
  name: "T3 Car",
  slug: "t3-car",
  platforms: ["ios"],
  scheme: "t3car",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#000000",
  ios: {
    supportsTablet: false,
    bundleIdentifier,
    ...(appleTeamId ? { appleTeamId } : {}),
    infoPlist: {
      // T3 Code servers on a LAN or tailnet are plain HTTP.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSLocalNetworkUsageDescription:
        "Allow T3 Car to connect to T3 Code servers on your local network or tailnet.",
      // Listening and speaking continue behind a navigation app and with the screen locked.
      UIBackgroundModes: ["audio"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    "expo-secure-store",
    "expo-sqlite",
    ["expo-audio", { microphonePermission: MICROPHONE_PURPOSE }],
    [
      "expo-speech-recognition",
      {
        microphonePermission: MICROPHONE_PURPOSE,
        speechRecognitionPermission:
          "T3 Car uses speech recognition to hear when you start and stop talking.",
      },
    ],
    ["expo-camera", { cameraPermission: "T3 Car scans the pairing code of your T3 Code server." }],
    ["expo-build-properties", { ios: { deploymentTarget: "18.0" } }],
  ],
  extra: {
    appVariant: "production",
    iosPersonalTeamBuild: true,
    // T3 Connect sign-in appears only in builds that carry this configuration; see
    // docs/operations/connect-setup.md.
    relay: { url: repoEnv.T3CODE_RELAY_URL ?? null },
    clerk: {
      publishableKey: repoEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
      jwtTemplate: repoEnv.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ?? null,
    },
    observability: { tracesUrl: null, tracesDataset: null, tracesToken: null },
  },
};

export default config;
