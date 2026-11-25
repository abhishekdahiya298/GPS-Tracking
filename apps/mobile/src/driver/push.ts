/** Notifications for drivers: the company's location requests, loads and low battery. */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { driver } from "./api";

export async function notificationsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Asks once (D2B) and registers this phone's push address for the driver's sign-in. */
export async function registerDriverPush(ask: boolean): Promise<boolean> {
  if (!Device.isDevice) return false;
  try {
    let p = await Notifications.getPermissionsAsync();
    if (!p.granted && ask && p.canAskAgain) p = await Notifications.requestPermissionsAsync();
    if (!p.granted) return false;
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("alerts", { name: "Alerts", importance: Notifications.AndroidImportance.HIGH });
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return false;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return false;
    await driver.setPushToken(token);
    return true;
  } catch {
    return false;
  }
}
