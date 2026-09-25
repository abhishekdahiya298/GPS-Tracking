import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const TONES = {
  info: { cls: "border-info/30 bg-info-soft text-info", Icon: Info },
  success: { cls: "border-success/30 bg-success-soft text-success", Icon: CheckCircle2 },
  warning: { cls: "border-warning/30 bg-warning-soft text-warning", Icon: AlertTriangle },
  danger: { cls: "border-danger/30 bg-danger-soft text-danger", Icon: XCircle }
} as const;

/** Inline, persistent message (use toast for transient feedback). */
export function Alert({ tone = "info", title, children, action, className }: { tone?: keyof typeof TONES; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, Icon } = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-foreground">
        {title && <p className="m-0 font-medium">{title}</p>}
        {children && <div className={cn("text-muted-foreground", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
