/**
 * Push notifications on this phone: ask permission, get the phone's push address (an Expo
 * push token) and register it with the server; undo all of that when switched off or on
 * sign-out. Nothing here throws: every failure comes back as a reason to show.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "../api";
import { DEFAULT_PREFS, parsePrefs, registrationBody, type PushPrefs, type PushProblem } from "./model";

const PREFS_KEY = "rio.push-prefs";
const TOKEN_KEY = "rio.push-token";

// A notification that arrives while the app is open still shows as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
});

export async function loadPrefs(): Promise<PushPrefs> {
  return parsePrefs(await SecureStore.getItemAsync(PREFS_KEY).catch(() => null));
}
/** The phone's time zone name ("Asia/Kolkata"), or null when the phone can't say. */
function phoneTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
const savePrefs = (prefs: PushPrefs) => SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(prefs)).catch(() => undefined);

async function pushToken(): Promise<string | null> {
  try {
    if (Platform.OS === "android") {
      // The server sends to the "alerts" channel; Android drops messages for a channel that doesn't exist.
      await Notifications.setNotificationChannelAsync("alerts", { name: "Alerts", importance: Notifications.AndroidImportance.HIGH });
    }
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data || null;
  } catch {
    return null;
  }
}

/**
 * Turns notifications on (asking the phone's permission the first time) or saves a changed
 * choice of alert kinds. Returns null when it worked, or why it didn't.
 */
export async function enablePush(prefs: PushPrefs): Promise<PushProblem | null> {
  if (!Device.isDevice) return "simulator";
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return "denied";
  } catch {
    return "denied";
  }
  const token = await pushToken();
  if (!token) return "no_token";
  try {
    await api.post("push/devices", registrationBody(token, Platform.OS === "ios" ? "ios" : "android", prefs, phoneTimeZone()));
  } catch {
    return "server";
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => undefined);
  await savePrefs({ ...prefs, enabled: true });
  return null;
}

/** Stops notifications to this phone. Safe to call when they were never on. */
export async function disablePush(keepChoices = true): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (token) await api.delete("push/devices", { token }).catch(() => undefined);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  const prefs = keepChoices ? await loadPrefs() : DEFAULT_PREFS;
  await savePrefs({ ...prefs, enabled: false });
}

/** App start while signed in: if notifications are on, register again so the server knows this phone is still in use. */
export async function refreshPushRegistration(): Promise<void> {
  const prefs = await loadPrefs();
  if (!prefs.enabled || !Device.isDevice) return;
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
  } catch {
    return;
  }
  const token = await pushToken();
  if (!token) return;
  await api.post("push/devices", registrationBody(token, Platform.OS === "ios" ? "ios" : "android", prefs, phoneTimeZone())).catch(() => undefined);
  await SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => undefined);
}
