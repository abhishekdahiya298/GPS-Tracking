/**
 * Capturing load paperwork: the document scanner (finds the edges, crops, flattens), the camera,
 * or a file/photo the driver already has. Photos are shrunk before upload (about 1,800 px, JPEG)
 * so they send quickly on a weak signal; PDFs go as they are.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { ApiError } from "@/api";
import { driver, type LoadPaperwork, type PaperworkUpload } from "./api";

export type CaptureMethod = "scan" | "camera" | "upload";
export interface Captured {
  uri: string;
  name: string;
  type: string;
  method: CaptureMethod;
}

async function shrink(uri: string): Promise<string> {
  try {
    const r = await manipulateAsync(uri, [{ resize: { width: 1800 } }], { compress: 0.72, format: SaveFormat.JPEG });
    return r.uri;
  } catch {
    return uri;
  }
}

/** The scanner; falls back to the camera when this phone or app build has no scanner. */
export async function scan(): Promise<Captured[]> {
  try {
    const mod = await import("react-native-document-scanner-plugin");
    const res = await mod.default.scanDocument({ croppedImageQuality: 80, maxNumDocuments: 5 });
    if (res.status === "cancel" || !res.scannedImages?.length) return [];
    const out: Captured[] = [];
    for (const [i, p] of res.scannedImages.entries()) {
      const uri = await shrink(p.startsWith("file://") ? p : `file://${p}`);
      out.push({ uri, name: `scan-${Date.now()}-${i + 1}.jpg`, type: "image/jpeg", method: "scan" });
    }
    return out;
  } catch {
    return camera("scan");
  }
}

export async function camera(method: CaptureMethod = "camera"): Promise<Captured[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("Allow the camera in Settings to take photos of your paperwork.");
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, exif: false });
  if (r.canceled || !r.assets?.length) return [];
  const uri = await shrink(r.assets[0]!.uri);
  return [{ uri, name: `photo-${Date.now()}.jpg`, type: "image/jpeg", method }];
}

export async function photos(): Promise<Captured[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 5, exif: false });
  if (r.canceled || !r.assets?.length) return [];
  const out: Captured[] = [];
  for (const a of r.assets) out.push({ uri: await shrink(a.uri), name: `photo-${Date.now()}-${out.length + 1}.jpg`, type: "image/jpeg", method: "upload" });
  return out;
}

export async function files(): Promise<Captured[]> {
  const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.length) return [];
  const a = r.assets[0]!;
  if ((a.size ?? 0) > 15 * 1024 * 1024) throw new Error("That file is over 15 MB. Take a photo or scan instead.");
  const pdf = (a.mimeType ?? "").includes("pdf") || a.name.toLowerCase().endsWith(".pdf");
  if (pdf) return [{ uri: a.uri, name: a.name, type: "application/pdf", method: "upload" }];
  return [{ uri: await shrink(a.uri), name: a.name.replace(/\.\w+$/, "") + ".jpg", type: "image/jpeg", method: "upload" }];
}

async function where(): Promise<{ lat: number | null; lon: number | null }> {
  try {
    const p = (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ?? null;
    return p ? { lat: p.coords.latitude, lon: p.coords.longitude } : { lat: null, lon: null };
  } catch {
    return { lat: null, lon: null };
  }
}

// ---------- sending, with a queue for no signal ----------

const QUEUE = "rio.paperwork.queue";
type Queued = { loadId: string; upload: PaperworkUpload; tries: number };

async function readQueue(): Promise<Queued[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(QUEUE)) ?? "[]") as Queued[];
  } catch {
    return [];
  }
}
async function writeQueue(q: Queued[]) {
  await AsyncStorage.setItem(QUEUE, JSON.stringify(q.slice(-40)));
}

/** How many items are waiting for a signal (for a "waiting to send" note). */
export async function pendingCount(loadId?: string): Promise<number> {
  return (await readQueue()).filter((q) => !loadId || q.loadId === loadId).length;
}

/**
 * Sends a capture now; with no signal it is kept and sent later (flushPaperwork), with the time
 * and place it was taken. Returns the new paperwork list when it went through.
 */
export async function sendPaperwork(loadId: string, itemKey: string, c: Captured): Promise<LoadPaperwork | "queued"> {
  const upload: PaperworkUpload = { itemKey, method: c.method, uri: c.uri, name: c.name, type: c.type, capturedAt: new Date().toISOString(), ...(await where()) };
  try {
    return await driver.uploadPaperwork(loadId, upload);
  } catch (e) {
    if (e instanceof ApiError && (e.kind === "network" || e.kind === "timeout" || e.kind === "server")) {
      await writeQueue([...(await readQueue()), { loadId, upload, tries: 0 }]);
      return "queued";
    }
    throw e;
  }
}

/** Sends whatever was captured without a signal. Safe to call often (screen open, app back). */
export async function flushPaperwork(): Promise<number> {
  const q = await readQueue();
  if (!q.length) return 0;
  const left: Queued[] = [];
  let sent = 0;
  for (const item of q) {
    try {
      await driver.uploadPaperwork(item.loadId, item.upload);
      sent++;
    } catch (e) {
      // A load that is no longer theirs, or a file the phone cleared: drop it. Network: keep.
      const keep = e instanceof ApiError && (e.kind === "network" || e.kind === "timeout" || e.kind === "server");
      if (keep && item.tries < 50) left.push({ ...item, tries: item.tries + 1 });
    }
  }
  await writeQueue(left);
  return sent;
}
