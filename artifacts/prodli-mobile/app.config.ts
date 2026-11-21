// Expo app config for ProdLi on iOS and Android (one codebase).
//
// Build-time settings come from environment variables (EAS: eas.json "env" or
// project secrets; locally: your shell). Google OAuth client IDs are public —
// they ship inside every app — so they can live in eas.json.
//
//   PRODLI_API              Account server. Default: https://app.prodli.com
//   GOOGLE_WEB_CLIENT_ID    The web OAuth client the server already trusts; the
//                           phone asks Google for an ID token for this audience.
//   GOOGLE_IOS_CLIENT_ID    An "iOS" OAuth client (bundle id com.prodli.app).
//                           Without it the iOS app can't show Google sign-in.
//   (Android needs no ID here: Google matches the app by package name and the
//    signing certificate's SHA-1, registered as an "Android" OAuth client.)
//
// See docs/MOBILE.md.
import type { ConfigContext, ExpoConfig } from "expo/config";

const API = process.env.PRODLI_API || "https://app.prodli.com";
const WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID || "1063523043715-kr5ff8rtrh9br7l9hin7efoo50ajo536.apps.googleusercontent.com";
const IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID || "";

/** "123-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.123-abc" (the URL scheme Google redirects to on iOS). */
const reversed = (id: string) => id.split(".").reverse().join(".");

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "ProdLi",
  slug: "prodli",
  owner: process.env.EXPO_OWNER || undefined,
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "prodli",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.prodli.app",
    // iPhone only for the first release (on iPad it runs in iPhone mode); turn on once tablet layouts are checked.
    supportsTablet: false,
    buildNumber: "1",
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.prodli.app",
    versionCode: 1,
    adaptiveIcon: { foregroundImage: "./assets/adaptive-icon.png", backgroundColor: "#000000" },
    // Only what the app uses. (Expo adds INTERNET itself.)
    permissions: ["android.permission.VIBRATE"],
    blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"],
  },
  web: { bundler: "metro", output: "single", favicon: "./assets/favicon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-sqlite",
    "expo-web-browser",
    ["expo-notifications", { color: "#FFD700" }],
    // In-person meetings: the microphone, also while the screen is locked (iOS background audio; Android foreground service).
    ["expo-audio", { microphonePermission: "ProdLi uses the microphone to record and transcribe in-person meetings when you tap Record.", recordAudioAndroid: true, enableBackgroundRecording: true, enableBackgroundPlayback: false }],
    ["expo-splash-screen", { image: "./assets/splash-icon.png", imageWidth: 160, resizeMode: "contain", backgroundColor: "#EDE1CF", dark: { image: "./assets/splash-icon.png", backgroundColor: "#171A21" } }],
    ...(IOS_CLIENT_ID ? [["@react-native-google-signin/google-signin", { iosUrlScheme: reversed(IOS_CLIENT_ID) }] as [string, unknown]] : []),
  ],
  experiments: { typedRoutes: false },
  extra: {
    api: API,
    googleWebClientId: WEB_CLIENT_ID,
    googleIosClientId: IOS_CLIENT_ID,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
