"use client";
import { relativeTime } from "@/lib/format";
import { useTime } from "./time-context";

/**
 * An instant shown in the viewer's effective time zone (see TimeProvider). The tooltip
 * carries the full date, seconds and zone abbreviation.
 */
export function LocalTime({ iso, className, withZone = false }: { iso: string; className?: string; withZone?: boolean }) {
  const t = useTime();
  return (
    <time dateTime={iso} className={className} title={t.full(iso)}>
      {t.dateTime(iso)}
      {withZone ? ` ${t.abbr(iso)}` : ""}
    </time>
  );
}

/** "5 min ago" with the exact local time (and zone) on hover. `null` renders "never". */
export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const t = useTime();
  if (!iso) return <span className={className}>never</span>;
  return (
    // Server and browser clocks differ by the request latency; "just now" vs "1 min ago" is fine.
    <time dateTime={iso} className={className} title={t.full(iso)} suppressHydrationWarning>
      {relativeTime(iso, Date.now(), t.timeZone)}
    </time>
  );
}

/** A calendar date ("Sep 25, 2026") in the viewer's zone. */
export function LocalDate({ iso, className }: { iso: string; className?: string }) {
  const t = useTime();
  return (
    <time dateTime={iso} className={className} title={t.full(iso)}>
      {t.date(iso)}
    </time>
  );
}
