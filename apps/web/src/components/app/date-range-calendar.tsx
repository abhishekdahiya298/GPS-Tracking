"use client";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays } from "@rio-gps/core/timezones";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * A calendar for picking a day range (tap a start day, then an end day), with optional start and
 * end times and one-tap time presets. Days are "YYYY-MM-DD" keys and times "HH:mm", both as wall
 * time in the viewer's zone; the caller converts to UTC. Days after `today` can't be picked.
 */
export interface DayRange {
  startDay: string;
  endDay: string;
  startTime: string;
  endTime: string;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIME_PRESETS: { label: string; start: string; end: string }[] = [
  { label: "All day", start: "00:00", end: "23:59" },
  { label: "Work hours 6 AM–6 PM", start: "06:00", end: "18:00" },
  { label: "Night 6 PM–6 AM", start: "18:00", end: "06:00" }
];

/** "Nov 20" from "2026-11-20". */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${SHORT_MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** Whole days from a to b, inclusive. */
export function daySpan(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
}

function monthDays(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: (string | null)[] = Array.from({ length: first }, () => null);
  for (let d = 1; d <= count; d++) out.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return out;
}

export function DateRangeCalendar({
  value,
  today,
  withTime = true,
  maxDays = 31,
  applyLabel = "Show trips",
  busy,
  onApply,
  onCancel
}: {
  value: DayRange;
  /** Today's "YYYY-MM-DD" in the viewer's zone. */
  today: string;
  withTime?: boolean;
  maxDays?: number;
  applyLabel?: string;
  busy?: boolean;
  onApply: (r: DayRange) => void;
  onCancel?: () => void;
}) {
  const [startDay, setStartDay] = useState(value.startDay);
  const [endDay, setEndDay] = useState<string | null>(value.endDay);
  const [startTime, setStartTime] = useState(value.startTime);
  const [endTime, setEndTime] = useState(value.endTime);
  const [view, setView] = useState(() => {
    const [y, m] = (value.endDay || today).split("-").map(Number);
    return { y: y!, m: m! - 1 };
  });
  const cells = useMemo(() => monthDays(view.y, view.m), [view]);
  const [ty, tm] = today.split("-").map(Number);
  const atCurrentMonth = view.y > ty! || (view.y === ty! && view.m >= tm! - 1);

  const pick = (day: string) => {
    // First tap (or a tap after a finished range) starts a new range; the second tap ends it.
    if (endDay !== null || day < startDay) {
      setStartDay(day);
      setEndDay(null);
      return;
    }
    if (daySpan(startDay, day) > maxDays) {
      setStartDay(day);
      setEndDay(null);
      return;
    }
    setEndDay(day);
  };
  const end = endDay ?? startDay;
  const span = daySpan(startDay, end);
  const preset = TIME_PRESETS.findIndex((p) => p.start === startTime && p.end === endTime);
  // A night that ends at 6 AM runs into the next morning.
  const overnight = withTime && endTime <= startTime && startDay === end;
  const step = (n: number) => setView((v) => {
    const m = v.m + n;
    return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-2 rounded-xl bg-muted/50 p-2.5 shadow-[inset_0_0_0_1px_var(--color-border)]">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon-sm" aria-label="Previous month" onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
          <b className="flex-1 text-center text-sm" aria-live="polite">
            {MONTHS[view.m]} {view.y}
          </b>
          <Button variant="secondary" size="icon-sm" aria-label="Next month" disabled={atCurrentMonth} onClick={() => step(1)}>
            <ChevronRight />
          </Button>
        </div>
        <div role="grid" aria-label="Pick days" className="grid grid-cols-7 gap-x-0.5 gap-y-1">
          {WEEKDAYS.map((w) => (
            <span key={w} className="text-center text-[11px] font-bold text-muted-foreground/80">
              {w}
            </span>
          ))}
          {cells.map((day, i) => {
            if (!day) return <span key={`b${i}`} />;
            const future = day > today;
            const edge = day === startDay || day === endDay;
            const inRange = day >= startDay && day <= end;
            return (
              <button
                key={day}
                type="button"
                disabled={future}
                aria-pressed={inRange}
                aria-label={shortDay(day)}
                onClick={() => pick(day)}
                className={cn(
                  "grid h-8 cursor-pointer place-items-center border-0 text-[13px] font-semibold tabular-nums transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground/40",
                  edge ? "rounded-full bg-primary font-extrabold text-primary-foreground" : inRange ? "rounded-lg bg-primary/15 text-foreground" : "rounded-lg bg-transparent text-foreground hover:bg-background",
                  day === today && !edge && "shadow-[inset_0_0_0_1.5px_var(--color-primary)]"
                )}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
        <p className="m-0 text-center text-xs text-muted-foreground">
          {endDay === null ? "Now tap the end day (or the same day again for one day)." : "Tap a start day, then an end day."}
        </p>
      </div>

      {withTime && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["Start", startDay, startTime, setStartTime],
                ["End", overnight ? addDays(end, 1) : end, endTime, setEndTime]
              ] as const
            ).map(([label, day, time, set]) => (
              <label key={label} className="grid gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
                <span className="flex h-10 min-w-0 items-center gap-1 rounded-[10px] bg-background pl-2.5 pr-1 shadow-[inset_0_0_0_1px_var(--color-border)]">
                  <span className="whitespace-nowrap text-[13px] font-bold">{shortDay(day)}</span>
                  <span className="flex-1" />
                  <span className="relative inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-primary">
                    <Clock className="size-3.5" />
                    <input
                      type="time"
                      aria-label={`${label} time`}
                      value={time}
                      onChange={(e) => e.target.value && set(e.target.value)}
                      className="w-[68px] cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-bold tabular-nums text-primary outline-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-datetime-edit]:p-0"
                    />
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Time of day">
            {TIME_PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                role="radio"
                aria-checked={preset === i}
                onClick={() => {
                  setStartTime(p.start);
                  setEndTime(p.end);
                }}
                className={cn(
                  "h-7 cursor-pointer rounded-full border-0 px-2.5 text-xs font-bold",
                  preset === i ? "bg-primary text-primary-foreground" : "bg-background text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)] hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12.5px] text-muted-foreground">
          <b className="text-foreground">
            {span} day{span === 1 ? "" : "s"}
          </b>{" "}
          · up to {maxDays} days
        </span>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button loading={busy} onClick={() => onApply({ startDay, endDay: overnight ? addDays(end, 1) : end, startTime: withTime ? startTime : "00:00", endTime: withTime ? endTime : "23:59" })}>
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * A button that shows the chosen days ("Nov 17 – Nov 23") and opens the calendar below it.
 * Days only (reports work in whole local days).
 */
export function DateRangeButton({ fromDay, toDay, today, maxDays = 31, onChange, onClear, placeholder = "Any date", className }: { fromDay: string | null; toDay: string | null; today: string; maxDays?: number; onChange: (from: string, to: string) => void; /** Shows a clear button and allows "no dates". */ onClear?: () => void; placeholder?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const f = fromDay || toDay;
  const t = toDay || fromDay;
  const label = !f || !t ? placeholder : f === t ? shortDay(f) : `${shortDay(f)} – ${shortDay(t)}`;
  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm font-semibold tabular-nums text-foreground hover:border-primary/50"
      >
        <CalendarDays className="size-4 text-primary" aria-hidden="true" />
        <span className="flex-1 truncate">{label}</span>
        {f && t && <span className="text-xs font-medium text-muted-foreground">{daySpan(f, t)} d</span>}
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
      </button>
      {onClear && f && (
        <button type="button" aria-label="Clear dates" onClick={onClear} className="absolute right-9 top-1/2 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md border-0 bg-muted text-muted-foreground hover:text-foreground">
          <X className="size-3.5" />
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Pick dates" className="absolute left-0 top-full z-50 mt-1.5 w-[330px] rounded-xl border border-border bg-background p-3 shadow-pop">
          <DateRangeCalendar
            value={{ startDay: f ?? today, endDay: t ?? today, startTime: "00:00", endTime: "23:59" }}
            today={today}
            withTime={false}
            maxDays={maxDays}
            applyLabel="Apply"
            onCancel={() => setOpen(false)}
            onApply={(r) => {
              onChange(r.startDay, r.endDay);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
