"use client";
import { dateFormatter, type DateFormatter, type TimeFormat } from "@rio-gps/core/timezones";
import { createContext, useContext, useMemo, type ReactNode } from "react";

const Ctx = createContext<DateFormatter>(dateFormatter("UTC", "12h"));

/**
 * The signed-in person's effective time zone and clock (their own choice, else the
 * organization's), resolved on the server. Server and browser therefore render the
 * same text: no hydration differences and no dependence on the device's clock settings.
 */
export function TimeProvider({ timeZone, timeFormat, children }: { timeZone: string; timeFormat: TimeFormat; children: ReactNode }) {
  const value = useMemo(() => dateFormatter(timeZone, timeFormat), [timeZone, timeFormat]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTime(): DateFormatter {
  return useContext(Ctx);
}
