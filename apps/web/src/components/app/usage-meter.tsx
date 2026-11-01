import { cn } from "@/lib/cn";

/** Used vs included, with the part over the allowance in a warning colour. */
export function UsageMeter({ used, included, label }: { used: number; included: number; label: string }) {
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const over = included > 0 && used > included;
  const near = !over && included > 0 && used >= included * 0.8;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className={cn("font-semibold text-foreground", over && "text-warning")}>{used.toLocaleString("en-US")}</span>
          {included > 0 ? ` of ${included.toLocaleString("en-US")} included` : ""}
        </span>
      </div>
      {included > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={included} aria-valuenow={used}>
          <div className={cn("h-full rounded-full transition-all", over || near ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      )}
      {over && <p className="m-0 text-xs text-warning">{(used - included).toLocaleString("en-US")} extra this month</p>}
    </div>
  );
}
