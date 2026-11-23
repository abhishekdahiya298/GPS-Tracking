/**
 * Accepts the ways people type phone numbers; returns E.164 or null.
 * Ten digits are taken as North American (+1), the region RIO serves.
 */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  return null;
}

export const PHONE_HINT = "Enter a phone number like (416) 555-0123 or +1 416 555 0123.";
