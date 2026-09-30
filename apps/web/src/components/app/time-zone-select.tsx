"use client";
import { NORTH_AMERICA_ZONES, allTimeZones, zoneOptionLabel } from "@rio-gps/core/timezones";
import { forwardRef, useEffect, useMemo, useState, type SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const CURATED = new Set(NORTH_AMERICA_ZONES.map((z) => z.id));

/**
 * Time zone picker: Canada and United States first (with the current abbreviation and UTC
 * offset, DST-aware), then every other IANA zone. A native <select>, so it's keyboard,
 * screen-reader and mobile friendly, and typing jumps to an entry.
 *
 * `defaultOption` adds a first entry with value "" (e.g. "Organization default (EDT)").
 */
export const TimeZoneSelect = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> & { defaultOption?: string }>(function TimeZoneSelect(
  { defaultOption, value, defaultValue, className, ...props },
  ref
) {
  // The full IANA list comes from the runtime's ICU data, which can differ between the server
  // and the browser; it is added after hydration so both first renders match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const groups = useMemo(() => {
    const now = Date.now();
    const label = (id: string) => zoneOptionLabel(id, now);
    return {
      canada: NORTH_AMERICA_ZONES.filter((z) => z.region === "Canada").map((z) => ({ id: z.id, label: label(z.id) })),
      us: NORTH_AMERICA_ZONES.filter((z) => z.region === "United States").map((z) => ({ id: z.id, label: label(z.id) })),
      other: ["UTC", ...(mounted ? allTimeZones().filter((id) => !CURATED.has(id) && id !== "UTC") : [])].map((id) => ({ id, label: id === "UTC" ? label(id) : id.replace(/_/g, " ") }))
    };
  }, [mounted]);
  // A stored zone outside the lists (older runtime data) is still shown, not silently replaced.
  const current = String(value ?? defaultValue ?? "");
  const known = current === "" || CURATED.has(current) || groups.other.some((o) => o.id === current);
  return (
    // w-full + min-w-0: a native select is as wide as its longest option; don't let it push the layout.
    <Select ref={ref} value={value} defaultValue={defaultValue} className={cn("w-full min-w-0", className)} {...props}>
      {defaultOption !== undefined && <option value="">{defaultOption}</option>}
      {!known && <option value={current}>{current.replace(/_/g, " ")}</option>}
      <optgroup label="Canada">
        {groups.canada.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="United States">
        {groups.us.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Other time zones">
        {groups.other.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );
});

/** The browser's own zone, for a "Use this device's time zone" shortcut. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
