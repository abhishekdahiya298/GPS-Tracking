"use client";
import { dateTime } from "@/lib/format";

/**
 * Absolute time in the viewer's own time zone. The server renders UTC; the
 * browser re-renders in local time (hydration difference is expected).
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning title={new Date(iso).toISOString()}>
      {dateTime(iso)}
    </time>
  );
}
