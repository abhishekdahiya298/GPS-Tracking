import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Row of search + filters above a list; wraps on small screens. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center", className)}>{children}</div>;
}

/** Segmented filter (e.g. All / Moving / Idle / Offline) with counts. */
export function SegmentedFilter<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-0 px-2.5 text-[13px] font-medium",
            value === o.value ? "bg-background text-foreground shadow-card" : "bg-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular-nums text-muted-foreground">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
