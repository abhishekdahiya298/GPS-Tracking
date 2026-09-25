import { cn } from "@/lib/cn";
import { Badge } from "../ui/badge";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

/**
 * Coloured dot + text label, so status is never conveyed by colour alone.
 * Use the presets for common states.
 */
export function StatusBadge({ tone, label, className, pulse }: { tone: StatusTone; label: string; className?: string; pulse?: boolean }) {
  return (
    <Badge tone={tone} className={className}>
      <span aria-hidden="true" className={cn("inline-block size-1.5 rounded-full bg-current", pulse && "animate-pulse")} />
      {label}
    </Badge>
  );
}

export const CONNECTIVITY: Record<string, { tone: StatusTone; label: string }> = {
  online: { tone: "success", label: "Online" },
  moving: { tone: "success", label: "Moving" },
  idle: { tone: "warning", label: "Idle" },
  offline: { tone: "neutral", label: "Offline" },
  never_seen: { tone: "neutral", label: "No data yet" },
  inactive: { tone: "neutral", label: "Deactivated" }
};

export function ConnectivityBadge({ status }: { status: string }) {
  const s = CONNECTIVITY[status] ?? { tone: "neutral" as const, label: status.replace(/_/g, " ") };
  return <StatusBadge tone={s.tone} label={s.label} pulse={status === "moving"} />;
}
