/**
 * Renewal reminders (registration, insurance, inspection…): state from calendar days only.
 * `today` and `dueDate` are local day keys ("YYYY-MM-DD") in the organization's time zone,
 * so a renewal due "Oct 31" is valid through the end of Oct 31 there.
 */
export const RENEWAL_TYPES = ["registration", "insurance", "inspection", "permit", "licence", "other"] as const;
export type RenewalType = (typeof RENEWAL_TYPES)[number];
export const RENEWAL_TYPE_LABEL: Record<RenewalType, string> = {
  registration: "Registration / plate",
  insurance: "Insurance",
  inspection: "Safety inspection",
  permit: "Permit",
  licence: "Driver's licence",
  other: "Other"
};

export type RenewalState = "ok" | "due_soon" | "overdue";
export interface RenewalStatus {
  state: RenewalState;
  /** Whole days until the due date; 0 = due today, negative = days overdue. */
  daysRemaining: number;
}

const dayNumber = (key: string) => Math.round(Date.parse(`${key}T12:00:00Z`) / 86_400_000);

export function renewalStatus(dueDate: string, remindDays: number, today: string): RenewalStatus {
  const daysRemaining = dayNumber(dueDate) - dayNumber(today);
  return { state: daysRemaining < 0 ? "overdue" : daysRemaining <= remindDays ? "due_soon" : "ok", daysRemaining };
}

/** "in 12 days", "today", "3 days ago". */
export function renewalDueText(daysRemaining: number): string {
  if (daysRemaining === 0) return "today";
  if (daysRemaining === 1) return "tomorrow";
  if (daysRemaining === -1) return "yesterday";
  return daysRemaining > 0 ? `in ${daysRemaining} days` : `${-daysRemaining} days ago`;
}
