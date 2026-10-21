/**
 * Parses a pasted list of trackers for bulk registration. Shared by the browser (live preview)
 * and the server (which re-checks everything). One tracker per line: an IMEI, optionally
 * followed by a name, separated by a comma, semicolon or tab. A header line and blank lines
 * are skipped, so a column copied from a spreadsheet works as is.
 */

export const BULK_IMPORT_MAX = 200;

export interface ImeiListRow {
  line: number;
  imei: string;
  name?: string;
}

export interface ImeiListProblem {
  line: number;
  text: string;
  reason: "not_15_digits" | "check_digit" | "duplicate";
}

export function parseImeiList(text: string): { rows: ImeiListRow[]; problems: ImeiListProblem[] } {
  const rows: ImeiListRow[] = [];
  const problems: ImeiListProblem[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const [first = "", ...rest] = trimmed.split(/[,;\t]/);
    // Spreadsheets often show IMEIs with spaces or dashes; only the digits matter.
    const imei = first.replace(/[\s-]/g, "");
    if (!/\d/.test(imei)) return; // a header such as "IMEI, Name"
    const name = rest.join(" ").trim().slice(0, 80) || undefined;
    if (!/^\d{15}$/.test(imei)) return void problems.push({ line, text: trimmed, reason: "not_15_digits" });
    if (!isValidImei(imei)) return void problems.push({ line, text: trimmed, reason: "check_digit" });
    if (seen.has(imei)) return void problems.push({ line, text: trimmed, reason: "duplicate" });
    seen.add(imei);
    rows.push({ line, imei, ...(name ? { name } : {}) });
  });
  return { rows, problems };
}

export const PROBLEM_LABEL: Record<ImeiListProblem["reason"], string> = {
  not_15_digits: "not 15 digits",
  check_digit: "fails the IMEI check (likely a typo)",
  duplicate: "listed twice"
};

/** Luhn check on a 15-digit IMEI (same rule as the server's `isValidImei`). */
export function isValidImei(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
