"use client";
/**
 * Small dependency-free charts for the dashboard. One series, one colour (the primary
 * hue), thin marks, hairline grid. Every value is also reachable without hovering through
 * the "Show as table" view, and by keyboard (arrow keys move the readout).
 */
import { useId, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

export interface ChartPoint {
  key: string;
  /** Axis label (shown sparsely) and table/tooltip label. */
  label: string;
  /** Full label for the tooltip and the table, e.g. "Fri, Sep 25". */
  longLabel?: string;
  value: number;
  /** Formatted value with unit, e.g. "182.4 mi". */
  valueLabel: string;
}

/** Round the axis top up to 1, 2, 2.5 or 5 × 10ⁿ and split it into `steps` clean ticks. */
export function niceScale(max: number, steps = 4): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / steps;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const top = step * steps;
  return { top, ticks: Array.from({ length: steps + 1 }, (_, i) => Math.round(i * step * 1000) / 1000) };
}

export function ColumnChart({
  data,
  ariaLabel,
  tableHeads,
  labelEvery = 7,
  className
}: {
  data: ChartPoint[];
  ariaLabel: string;
  /** [category, value] column headings for the table view. */
  tableHeads: [string, string];
  /** Show an x-axis label on every n-th column, counted back from the last one. */
  labelEvery?: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  // Fixed locale: identical on the server and in the browser. (Props must be serializable, so no formatter prop.)
  const formatTick = (v: number) => v.toLocaleString("en-US");
  const { top, ticks } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const last = data.length - 1;
  const cur = active === null ? null : data[active];

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => Math.min(last, Math.max(0, (a ?? (e.key === "ArrowRight" ? -1 : last + 1)) + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Escape") setActive(null);
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        {/* y axis */}
        <div className="relative h-44 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${100 - (t / top) * 100}%` }}>
              {formatTick(t)}
            </span>
          ))}
          {/* widest tick reserves the column width */}
          <span className="invisible whitespace-nowrap">{formatTick(top)}</span>
        </div>

        {/* plot */}
        <div
          role="group"
          tabIndex={0}
          aria-label={`${ariaLabel}. Use the left and right arrow keys to read each value.`}
          aria-describedby={cur ? tipId : undefined}
          className="relative h-44 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <div key={t} aria-hidden="true" className={cn("absolute inset-x-0 border-t", t === 0 ? "border-input" : "border-border")} style={{ top: `${100 - (t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-stretch">
            {data.map((d, i) => (
              // The whole slot is the hit target, not just the painted bar.
              <div key={d.key} className="flex min-w-0 flex-1 items-end justify-center px-px" onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                <div
                  className={cn("w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity", active !== null && active !== i && "opacity-45")}
                  style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
                />
              </div>
            ))}
          </div>
          {cur && active !== null && (
            <div
              id={tipId}
              role="status"
              className="pointer-events-none absolute top-0 z-10 -translate-y-full whitespace-nowrap rounded-md border border-border bg-background px-2.5 py-1.5 text-xs shadow-pop"
              style={
                // Keep the readout inside the plot: anchor it left, centre or right of its column.
                active < data.length * 0.2
                  ? { left: `${(active / data.length) * 100}%` }
                  : active > data.length * 0.8
                    ? { right: `${((last - active) / data.length) * 100}%` }
                    : { left: `${((active + 0.5) / data.length) * 100}%`, translate: "-50% -100%" }
              }
            >
              <div className="font-semibold text-foreground">{cur.valueLabel}</div>
              <div className="text-muted-foreground">{cur.longLabel ?? cur.label}</div>
            </div>
          )}
        </div>

        {/* x axis: part of the layout, so the card grows instead of clipping labels */}
        <div />
        <div className="relative mt-1.5 h-4 text-[11px] text-muted-foreground" aria-hidden="true">
          {data.map((d, i) =>
            (last - i) % labelEvery === 0 ? (
              <span
                key={d.key}
                className={cn("absolute whitespace-nowrap", i === last ? "right-0" : "-translate-x-1/2")}
                style={i === last ? undefined : { left: `${((i + 0.5) / data.length) * 100}%` }}
              >
                {d.label}
              </span>
            ) : null
          )}
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-md border border-border">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  {tableHeads[0]}
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">
                  {tableHeads[1]}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.key} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    {d.longLabel ?? d.label}
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.valueLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** A single ratio: fill on a lighter step of the same hue. `value` is 0..1. */
const BAR_TONE = { primary: ["bg-primary-soft", "bg-primary"], warning: ["bg-warning-soft", "bg-warning"], danger: ["bg-danger-soft", "bg-danger"] } as const;

export function Meter({ value, label, tone = "primary" }: { value: number; label: string; tone?: keyof typeof BAR_TONE }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={`${Math.round(pct)}%`} className={`h-2.5 overflow-hidden rounded-full ${BAR_TONE[tone][0]}`}>
      <div className={`h-full origin-left animate-grow-x rounded-full ${BAR_TONE[tone][1]}`} style={{ width: `${pct}%`, minWidth: pct > 0 ? 4 : 0 }} />
    </div>
  );
}

/** Ranked horizontal bars: name and value as text, the bar underneath (values never rely on the bar alone). */
export function BarList({ rows, ariaLabel, tone = "primary" }: { rows: { key: string; label: string; value: number; valueLabel: string; sub?: string }[]; ariaLabel: string; tone?: keyof typeof BAR_TONE }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol aria-label={ariaLabel} className="m-0 grid list-none gap-3 p-0">
      {rows.map((r) => (
        <li key={r.key} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              {r.valueLabel}
              {r.sub && <span className="ml-2 text-xs text-muted-foreground">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2" aria-hidden="true">
            <div className={`h-full origin-left animate-grow-x rounded-full ${BAR_TONE[tone][1]}`} style={{ width: `${(r.value / max) * 100}%`, minWidth: 4 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
