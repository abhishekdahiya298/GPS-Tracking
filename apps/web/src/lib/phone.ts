import { checkPhone } from "@rio-gps/core/phone";

/**
 * Accepts the ways people type phone numbers; returns E.164 or null.
 * RIO GPS works with Canada and the US (+1); the rules live in @rio-gps/core/phone so the
 * website, the app and the server check numbers the same way.
 */
export function normalizePhone(raw: string): string | null {
  const r = checkPhone(raw);
  return r.ok ? r.e164 : null;
}

/** What's wrong with a number, in plain words (null when it's fine). */
export function phoneProblem(raw: string): string | null {
  const r = checkPhone(raw);
  return r.ok ? null : r.error;
}

export const PHONE_HINT = "Enter a Canada or US mobile number like (416) 555-0123.";
