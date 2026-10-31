import type { StatusTone } from "@/components/app/status-badge";

/** One label and colour per customer status, used wherever a customer's status is shown. */
export const CUSTOMER_STATUS: Record<"active" | "suspended" | "archived", { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" }
};
