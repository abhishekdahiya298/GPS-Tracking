import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const TONES = {
  navy: "bg-primary-soft text-primary",
  green: "bg-success-soft text-success",
  amber: "bg-warning-soft text-warning",
  red: "bg-danger-soft text-danger",
  blue: "bg-info-soft text-info"
} as const;

/** Card title with a small tinted icon, so every dashboard card reads the same way. */
export function IconTitle({ icon: Icon, tone = "navy", children, sub }: { icon: LucideIcon; tone?: keyof typeof TONES; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TONES[tone])}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="m-0 text-[15px] font-semibold leading-6 text-[#0a2463]">{children}</h2>
        {sub && <div className="m-0 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}
