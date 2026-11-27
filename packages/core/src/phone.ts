/**
 * Phone numbers for RIO GPS: Canada and the United States (+1, NANP).
 * One set of rules for the server, the website and the app, so a number is checked the same
 * way everywhere: as it's typed, on Save, and again on the server.
 */

export type PhoneCountry = "CA" | "US";

/** Canadian area codes (CRTC, current and announced overlays). */
const CANADA = new Set([
  "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368", "382", "403", "416", "418", "428", "431", "437", "438", "450", "468",
  "474", "506", "514", "519", "548", "579", "581", "584", "587", "600", "604", "613", "639", "647", "672", "683", "705", "709", "742", "753", "778", "780", "782", "807",
  "819", "825", "867", "873", "879", "902", "905", "942"
]);

/** NANP area codes outside Canada and the US (Caribbean and Atlantic islands). */
const OTHER_NANP = new Set(["242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767", "784", "809", "829", "849", "868", "869", "876"]);

/** Toll-free and service codes: never someone's mobile. */
const NOT_PERSONAL = new Set(["800", "822", "833", "844", "855", "866", "877", "880", "881", "882", "888", "900"]);

export const PHONE_EXAMPLE: Record<PhoneCountry, string> = { CA: "(416) 555-0142", US: "(212) 555-0142" };
export const PHONE_COUNTRIES: { code: PhoneCountry; name: string; flag: string }[] = [
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "US", name: "United States", flag: "🇺🇸" }
];

export type PhoneCheck =
  | { ok: true; e164: string; national: string; country: PhoneCountry }
  | { ok: false; error: string; /** Too few digits so far: fine while typing, an error on Save. */ incomplete?: boolean };

/** Just the ten national digits, or what there is of them so far (a leading +1 / 1 is dropped). */
export function nationalDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if ((raw.trim().startsWith("+") || d.length === 11) && d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
}

/** Which country an area code belongs to, or null when it isn't Canada or the US. */
export function countryOfAreaCode(area: string): PhoneCountry | null {
  if (CANADA.has(area)) return "CA";
  if (OTHER_NANP.has(area)) return null;
  return /^[2-9]\d\d$/.test(area) ? "US" : null;
}

/**
 * Checks a number typed in any common way ("416 555 0142", "(416) 555-0142", "+1 416-555-0142",
 * "14165550142"). `country` is what the picker shows; a number whose area code is in the other
 * country is still accepted and `country` in the answer says which one it is.
 */
export function checkPhone(raw: string): PhoneCheck {
  const s = raw.trim();
  if (!s) return { ok: false, error: "Enter a mobile number.", incomplete: true };
  if (/[a-z]/i.test(s.replace(/\s*(ext|x)\.?\s*\d+$/i, ""))) return { ok: false, error: "Use digits only, like (416) 555-0142." };
  if (s.startsWith("+") && !s.replace(/\D/g, "").startsWith("1")) return { ok: false, error: "RIO GPS works with Canada and US numbers (+1) for now." };
  const all = s.replace(/\D/g, "");
  if (all.length > 11 || (all.length === 11 && !all.startsWith("1"))) return { ok: false, error: "That's too many digits. Enter 10 digits." };
  const d = nationalDigits(s);
  if (d.length < 10) return { ok: false, error: "Enter all 10 digits.", incomplete: true };
  const area = d.slice(0, 3);
  const exchange = d.slice(3, 6);
  if (!/^[2-9]/.test(area)) return { ok: false, error: `Area codes don't start with ${area[0]}. Check the number.` };
  if (/^[2-9]11$/.test(area) || NOT_PERSONAL.has(area)) return { ok: false, error: "That's a service or toll-free number. Enter a mobile number." };
  if (!/^[2-9]/.test(exchange)) return { ok: false, error: `The 3 digits after the area code don't start with ${exchange[0]}. Check the number.` };
  if (/^[2-9]11$/.test(exchange)) return { ok: false, error: "That number can't be a mobile number. Check it." };
  const country = countryOfAreaCode(area);
  if (!country) return { ok: false, error: "RIO GPS works with Canada and US numbers for now." };
  return { ok: true, e164: `+1${d}`, national: formatNational(d), country };
}

/** (416) 555-0142, building up as digits are typed. */
export function formatNational(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** E.164 for a valid Canada/US number, else null. */
export function toE164(raw: string): string | null {
  const r = checkPhone(raw);
  return r.ok ? r.e164 : null;
}

/** How a stored +1 number is shown: (416) 555-0142. Other values are returned as they are. */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{10})$/.exec(e164);
  return m ? formatNational(m[1]!) : e164;
}
