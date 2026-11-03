import Constants from "expo-constants";
import { Platform } from "react-native";

/** This build's version (app.json "version") and platform, as the server knows them. */
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
export const APP_PLATFORM: "android" | "ios" = Platform.OS === "ios" ? "ios" : "android";

const listeners = new Set<() => void>();
/** The API answered 426: this version must be updated. */
export function emitUpdateRequired() {
  listeners.forEach((l) => l());
}
export function onUpdateRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
