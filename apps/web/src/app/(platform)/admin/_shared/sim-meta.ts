import type { StatusTone } from "@/components/app/status-badge";

export const SIM_STATUS: Record<"inventory" | "active" | "suspended" | "cancelled", { label: string; tone: StatusTone; hint: string }> = {
  inventory: { label: "Not activated", tone: "neutral", hint: "Bought, not activated with the carrier (no monthly charge)." },
  active: { label: "Active", tone: "success", hint: "Activated with the carrier and billed every month." },
  suspended: { label: "Suspended", tone: "warning", hint: "Paused with the carrier." },
  cancelled: { label: "Cancelled", tone: "danger", hint: "Closed with the carrier; kept for the record." }
};
