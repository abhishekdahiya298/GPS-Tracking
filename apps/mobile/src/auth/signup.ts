/**
 * Create a free account from the app: the same three steps and server routes as the website.
 * One code goes to the email and the phone; after the code the app signs in with the password.
 * Public routes check the Origin, so these requests carry the server's own address.
 */
import { api } from "../api";
import { API_BASE_URL } from "../config";

const origin = new URL(API_BASE_URL).origin;
const post = <T,>(path: string, body: unknown) => api.send<T>(path, { method: "POST", anonymous: true, headers: { Origin: origin }, body }).then((r) => r.data);

export type Role = "fleet" | "operator" | "broker";
export const FLEET_SIZES = ["1", "2-5", "6-20", "21-50", "50+"] as const;
export type SentTo = { email: string | null; phone: string | null };

export interface CompanyDetails {
  role: Role;
  company: string;
  name: string;
  phone: string;
  email: string;
  password: string;
  fleetSize: (typeof FLEET_SIZES)[number];
  country: "CA" | "US";
  timeZone: string;
}

export const signup = {
  start: (d: CompanyDetails) => post<{ status: "code_sent"; token: string; sentTo: SentTo } | { status: "created"; email: string }>("signup/start", { ...d, agree: true }),
  verify: (token: string, code: string, password?: string) => post<{ status: "created"; email: string } | { status: "joined"; companyName: string }>("signup/verify", { token, code, password }),
  resend: (token: string) => post<{ sentTo: SentTo }>("signup/resend", { token }),
  joinCompany: (code: string, name: string, phone: string) => post<{ status: "code_sent"; token: string; sentTo: SentTo; companyName: string } | { status: "joined"; companyName: string }>("signup/join", { code, name, phone })
};

/** The phone's time zone, or Toronto. */
export function phoneZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}

/** Canada or US from the time zone (the person can change it). */
export function guessCountry(zone: string): "CA" | "US" {
  return /^(America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Moncton|Montreal|Whitehorse|Yellowknife|Iqaluit|Glace_Bay|Goose_Bay|Dawson_Creek|Swift_Current))/.test(zone) ? "CA" : zone.startsWith("America/") ? "US" : "CA";
}

/** Between S2 and S3 only: the email and password to sign in with after the code. Memory only, never stored. */
export const pendingSignIn: { email: string; password: string } = { email: "", password: "" };
