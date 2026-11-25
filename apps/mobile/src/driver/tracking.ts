/**
 * Always-on location while the driver is signed in (WF2). The phone's own background location
 * service wakes this task with new fixes; each batch goes to the server with the battery level
 * and permission. Without signal, points wait in a queue (up to 500) and go with the next batch.
 *
 * The task is defined when this file is imported, which must happen at app start (root layout),
 * so the phone can run it after waking the app in the background.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Battery from "expo-battery";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { driver, driverTokens } from "./api";
import { mergeQueue, permissionFrom, toPoints, type Permission, type ReportPoint } from "./model";

export const LOCATION_TASK = "rio-driver-location";
const QUEUE_KEY = "rio.driver-queue";

async function readQueue(): Promise<ReportPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as ReportPoint[]) : [];
  } catch {
    return [];
  }
}
const writeQueue = (q: ReportPoint[]) => (q.length ? AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)) : AsyncStorage.removeItem(QUEUE_KEY)).catch(() => undefined);

export async function phonePermission(): Promise<{ permission: Permission; locationEnabled: boolean }> {
  try {
    const [fg, bg, on] = await Promise.all([Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync(), Location.hasServicesEnabledAsync()]);
    return { permission: permissionFrom(fg.granted, bg.granted), locationEnabled: on };
  } catch {
    return { permission: "off", locationEnabled: false };
  }
}

async function battery(): Promise<{ pct: number; charging: boolean } | undefined> {
  try {
    const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
    if (level < 0) return undefined;
    return { pct: Math.round(level * 100), charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL };
  } catch {
    return undefined;
  }
}

let sending = false;
/** Sends queued + new points with battery and permission. Points stay queued if the send fails. */
export async function sendReport(newPoints: ReportPoint[] = []): Promise<boolean> {
  if (!(await driverTokens.get())) return false;
  const queue = mergeQueue(await readQueue(), newPoints);
  if (sending) {
    await writeQueue(queue);
    return false;
  }
  sending = true;
  try {
    const [status, batt] = await Promise.all([phonePermission(), battery()]);
    await driver.report({ points: queue, battery: batt, ...status });
    await writeQueue([]);
    return true;
  } catch {
    await writeQueue(queue);
    return false;
  } finally {
    sending = false;
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await sendReport(toPoints(data.locations));
});

/** Starts sharing (after the driver allowed location). Safe to call again. */
export async function startTracking(companyName: string): Promise<boolean> {
  const { permission } = await phonePermission();
  if (permission === "off") return false;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      // A fix every 50 m or every minute while moving; the phone batches them when the screen is off.
      distanceInterval: 50,
      timeInterval: 60_000,
      deferredUpdatesInterval: 60_000,
      deferredUpdatesDistance: 200,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: `Sharing location with ${companyName}`,
        notificationBody: "RIO GPS shares your location while you're signed in.",
        notificationColor: "#1d4ed8",
        killServiceOnDestroy: false
      }
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // not running
  }
  await writeQueue([]);
}

/** Asks for location: first "while using", then "Always" (the phone shows its own dialogs). */
export async function askLocation(): Promise<Permission> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return "off";
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.granted ? "always" : "while_using";
  } catch {
    return "off";
  }
}

export const isAndroid = Platform.OS === "android";
