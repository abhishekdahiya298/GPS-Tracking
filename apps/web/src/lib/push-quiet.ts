/**
 * Quiet hours for push notifications: a phone can ask for no notifications between two
 * times of day, in its own time zone. Pure, so it is unit-tested without a database.
 */

/** Minutes after midnight in a time zone, or null when the zone name is not a real one. */
export function minutesInZone(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? (hour % 24) * 60 + minute : null;
  } catch {
    return null;
  }
}

export const isTimeZone = (name: string): boolean => minutesInZone(new Date(0), name) !== null;

/**
 * True when `now` falls inside the phone's quiet time. The quiet time may run past midnight
 * (22:00 to 06:00). Anything missing or unusable means "not quiet": it is better to send a
 * notification nobody wanted than to drop one somebody needed.
 */
export function inQuietHours(now: Date, quietStart: number | null, quietEnd: number | null, timeZone: string | null): boolean {
  if (quietStart === null || quietEnd === null || !timeZone || quietStart === quietEnd) return false;
  const at = minutesInZone(now, timeZone);
  if (at === null) return false;
  return quietStart < quietEnd ? at >= quietStart && at < quietEnd : at >= quietStart || at < quietEnd;
}
