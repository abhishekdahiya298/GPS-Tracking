/**
 * Parsing for pasted tracker and SIM lists (one item per line, any of comma, tab, semicolon or
 * space between values), shared by the browser preview and the server. Values are recognized by
 * shape, so columns can come in any order:
 * - IMEI: exactly 15 digits
 * - ICCID: 18 to 22 digits (SIM cards start with 89)
 * - phone: starts with + or has 10 to 14 digits
 */

export interface ParsedInventoryLine {
  line: number;
  raw: string;
  imei: string | null;
  iccid: string | null;
  msisdn: string | null;
  problem: string | null;
}

const digitsOnly = (s: string) => s.replace(/[\s().-]/g, "");

export function normalizeIccid(v: string): string {
  return v.replace(/\D/g, "");
}

export function isIccid(v: string): boolean {
  return /^\d{18,22}$/.test(v);
}

/** "+1 (805) 666-5977" → "+18056665977"; returns null for anything that isn't a phone number. */
export function normalizeMsisdn(v: string): string | null {
  const s = digitsOnly(v.trim());
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^\d{10,14}$/.test(s)) return s;
  return null;
}

export function parseInventoryLines(text: string, max = 500): ParsedInventoryLine[] {
  const out: ParsedInventoryLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const raw = lines[i]!.trim();
    if (!raw || raw.startsWith("#")) continue;
    // Spaces inside a phone number are common, so split on separators first, then on spaces only for long digit runs.
    const tokens = raw
      .split(/[,;\t]+/)
      .flatMap((t) => (/^[\d\s]+$/.test(t.trim()) && t.trim().split(/\s+/).some((x) => x.length >= 15) ? t.trim().split(/\s+/) : [t.trim()]))
      .filter(Boolean);
    let imei: string | null = null;
    let iccid: string | null = null;
    let msisdn: string | null = null;
    const unknown: string[] = [];
    for (const t of tokens) {
      const d = t.replace(/\s/g, "");
      if (!imei && /^\d{15}$/.test(d)) imei = d;
      else if (!iccid && isIccid(d)) iccid = d;
      else if (!msisdn && normalizeMsisdn(t)) msisdn = normalizeMsisdn(t);
      else unknown.push(t);
    }
    const problem = !imei && !iccid ? "No IMEI (15 digits) or SIM number (18-22 digits) found" : unknown.length ? `Didn't understand: ${unknown.join(", ")}` : null;
    out.push({ line: i + 1, raw, imei, iccid, msisdn, problem });
  }
  return out;
}
