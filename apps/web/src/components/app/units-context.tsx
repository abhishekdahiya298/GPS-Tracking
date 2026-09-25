"use client";
import { units, type UnitSystem, type Units } from "@rio-gps/core";
import { createContext, useContext, useMemo, type ReactNode } from "react";

const Ctx = createContext<Units>(units("imperial"));

/** Organization display units for client components (values stay metric). */
export function UnitsProvider({ system, children }: { system: UnitSystem; children: ReactNode }) {
  const value = useMemo(() => units(system), [system]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUnits(): Units {
  return useContext(Ctx);
}
