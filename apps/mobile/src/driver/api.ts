/**
 * The driver app's own sign-in, kept apart from an owner's account: a different token, stored
 * under its own key, sent only to /api/v1/driver-app/*. A phone is signed in as one or the other.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createApiClient, type TokenStore } from "../api/client";
import { API_BASE_URL } from "../config";
import { APP_PLATFORM, APP_VERSION, emitUpdateRequired } from "../updates/events";
import type { DriverLoad, Permission, ReportPoint } from "./model";

const TOKEN_KEY = "rio.driver-token";

export const driverTokens: TokenStore = {
  get: () => SecureStore.getItemAsync(TOKEN_KEY),
  set: (token) => SecureStore.setItemAsync(TOKEN_KEY, token),
  clear: () => SecureStore.deleteItemAsync(TOKEN_KEY)
};

const endedListeners = new Set<() => void>();
/** The server ended the driver's sign-in (signed out by the company, made inactive). */
export function onDriverSignedOut(listener: () => void): () => void {
  endedListeners.add(listener);
  return () => void endedListeners.delete(listener);
}

export const driverApi = createApiClient({
  baseUrl: API_BASE_URL,
  tokens: driverTokens,
  onSignedOut: () => endedListeners.forEach((l) => l()),
  appInfo: { version: APP_VERSION, platform: APP_PLATFORM },
  onUpdateRequired: emitUpdateRequired
});

export interface DriverMe {
  driver: { id: string; name: string; phone: string | null; email?: string | null; licenseNumber?: string | null; licenseExpiresOn?: string | null };
  /** This company's link: pending until the driver accepts (older servers leave it out). */
  link?: "pending" | "active" | "declined" | "left" | "self";
  pendingRequests?: number;
  companiesSharing?: number;
  company: { id: string; name: string; phone: string | null };
  vehicle: { id: string; name: string; licensePlate: string | null } | null;
  sharing: { always: true; note: string };
  locationRequest: { at: string; from: string | null } | null;
}
interface SessionReply {
  token: string;
  driver: { id: string; name: string; phone: string | null };
  company: { id: string; name: string };
}
export interface DriverRequest {
  id: string;
  company: { id: string; name: string; phone: string | null };
  askedAt: string;
}
export interface DriverCompany {
  id: string;
  company: { id: string; name: string; phone: string | null };
  link: "pending" | "active" | "declined" | "left";
  since: string;
  vehicle: { name: string; licensePlate: string | null } | null;
  current: boolean;
}
export interface LoadRequest {
  id: string;
  reference: string;
  from: { id: string; name: string; phone: string | null };
  pickup: { name: string | null; address: string; appointmentAt: string | null };
  delivery: { name: string | null; address: string; appointmentAt: string | null };
  notes: string | null;
  askedAt: string;
}
export type LoadAnswer = "accept" | "decline" | "stop" | "resume";
export type StatsRange = "today" | "week" | "month";
export interface DriverStats {
  range: StatsRange;
  from: string;
  to: string;
  totals: { distanceKm: number; drivingMin: number; idleMin: number; trips: number; maxSpeedKph: number | null; daysDriven: number };
  days: { day: string; distanceKm: number; drivingMin: number }[];
  byCompany: { company: { id: string; name: string }; distanceKm: number; drivingMin: number; trips: number }[];
  updatedAt: string | null;
}
export type ProfilePatch = { name?: string; email?: string; licenseNumber?: string; licenseExpiresOn?: string };
export type InvitePeek = { state: "ok" | "used" | "expired" | "unknown"; driverName?: string; companyName?: string };

export const device = () => ({
  platform: Platform.OS === "ios" ? ("ios" as const) : ("android" as const),
  appVersion: String(Constants.expoConfig?.version ?? APP_VERSION),
  deviceModel: Device.modelName ?? undefined
});

async function keep(reply: SessionReply): Promise<SessionReply> {
  await driverTokens.set(reply.token);
  return reply;
}

/** Where the sign-in code went: a text (sms), the email the company has (email), or nowhere known (null). */
export type PhoneStart = { sentTo: string | null; channel?: "sms" | "email" | null };

export const driver = {
  peekInvite: (t: string) => driverApi.send<InvitePeek>("driver-app/invite", { query: { t }, anonymous: true }).then((r) => r.data),
  redeemInvite: async (t: string) => keep((await driverApi.send<SessionReply>("driver-app/invite", { method: "POST", anonymous: true, body: { token: t, device: device() } })).data),
  startPhone: (phone: string) => driverApi.send<PhoneStart>("driver-app/phone/start", { method: "POST", anonymous: true, body: { phone } }).then((r) => r.data),
  verifyPhone: async (phone: string, code: string) => keep((await driverApi.send<SessionReply>("driver-app/phone/verify", { method: "POST", anonymous: true, body: { phone, code, device: device() } })).data),
  me: () => driverApi.get<DriverMe>("driver-app/me"),
  loads: () => driverApi.get<{ loads: DriverLoad[] }>("driver-app/loads").then((r) => r.loads),
  report: (body: { points: ReportPoint[]; battery?: { pct: number; charging?: boolean }; permission?: Permission; locationEnabled?: boolean }) =>
    driverApi.post<{ stored: number }>("driver-app/report", { ...body, appVersion: device().appVersion, platform: device().platform }),
  requests: () => driverApi.get<{ requests: DriverRequest[]; companies: DriverCompany[]; loads?: LoadRequest[] }>("driver-app/requests"),
  answerLoad: (id: string, action: LoadAnswer) => driverApi.post<{ loads: DriverLoad[]; requests: LoadRequest[] }>(`driver-app/loads/${id}`, { action }),
  respond: (id: string, accept: boolean) => driverApi.post<{ requests: DriverRequest[]; companies: DriverCompany[] }>(`driver-app/requests/${id}`, { accept }),
  leave: (id: string) => driverApi.post<{ signedOut: boolean; movedTo: { id: string; name: string } | null }>(`driver-app/companies/${id}/leave`),
  updateProfile: (patch: ProfilePatch) => driverApi.send<DriverMe>("driver-app/me", { method: "PATCH", body: patch }).then((r) => r.data),
  stats: (range: StatsRange) => driverApi.get<DriverStats>("driver-app/stats", { range }),
  setPushToken: (token: string | null) => driverApi.send<void>("driver-app/push", { method: "PUT", body: { token } }),
  /** Always ends the sign-in on this phone, even without signal. */
  async signOut() {
    try {
      await driverApi.post("driver-app/signout");
    } catch {
      // the token is removed below either way
    } finally {
      await driverTokens.clear();
    }
  }
};
