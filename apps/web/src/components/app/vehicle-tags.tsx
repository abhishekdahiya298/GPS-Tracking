"use client";
import { Power } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { TableDensity } from "./data-table";

/**
 * Small, consistent labels for a vehicle's identity, used in every list, card and
 * page (vehicles, live map, drivers, loads): plate, VIN, list order and ignition.
 */

const tag = "inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] bg-muted px-1.5 text-[10.5px] font-bold text-foreground/80 shadow-[inset_0_0_0_1px_var(--color-border)]";

export function PlateTag({ plate, region, className }: { plate: string | null | undefined; region?: string | null; className?: string }) {
  if (!plate) return null;
  return (
    <span className={cn(tag, className)} title={region ? `Plate ${plate} (${region})` : `Plate ${plate}`}>
      {plate}
    </span>
  );
}

/** Full 17-character VIN in a fixed-width font (easy to read and compare); `short` shows the last 5. */
export function VinTag({ vin, short, className }: { vin: string | null | undefined; short?: boolean; className?: string }) {
  if (!vin) return null;
  return (
    <span className={cn(tag, "font-semibold", className)} title={`VIN ${vin}`}>
      <span className="font-bold text-muted-foreground">VIN</span>
      <span className="font-mono tracking-wide">{short ? `…${vin.slice(-5)}` : vin}</span>
    </span>
  );
}

/** The company's list order (#1 shows first). */
export function OrderBadge({ order, className }: { order: number | null | undefined; className?: string }) {
  if (order == null) return null;
  return (
    <span title="List order" className={cn("inline-grid h-[18px] min-w-[22px] shrink-0 place-items-center rounded-[6px] bg-primary px-1 text-[10.5px] font-extrabold text-primary-foreground", className)}>
      #{order}
    </span>
  );
}

/** "2022 Freightliner Cascadia", or null when nothing is known. */
export function yearMakeModel(v: { modelYear?: number | null; make?: string | null; model?: string | null }) {
  const s = [v.modelYear, v.make, v.model].filter(Boolean).join(" ");
  return s || null;
}

/** Round ignition indicator: green when on, grey when off; nothing for trailers (no ignition). */
export function IgnitionDot({ ignition, className }: { ignition: boolean | null | undefined; className?: string }) {
  if (ignition == null) return null;
  const label = ignition ? "Ignition on" : "Ignition off";
  return (
    <span
      title={label}
      role="img"
      aria-label={label}
      className={cn(
        "inline-grid size-6 shrink-0 place-items-center rounded-full",
        ignition ? "bg-[#16a34a]/12 text-[#15803d] shadow-[inset_0_0_0_1px_rgb(22_163_74/0.35)] dark:text-[#4ade80]" : "bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]",
        className
      )}
    >
      <Power className="size-3" strokeWidth={2.6} aria-hidden="true" />
    </span>
  );
}

/** Each person's row-height choice, remembered in this browser (per list). */
export function useDensity(key: string, fallback: TableDensity = "comfortable") {
  const storageKey = `rio.density.${key}`;
  const [density, setDensity] = useState<TableDensity>(fallback);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === "compact" || v === "comfortable") setDensity(v);
    } catch {
      /* storage blocked: keep the default */
    }
  }, [storageKey]);
  const update = (d: TableDensity) => {
    setDensity(d);
    try {
      window.localStorage.setItem(storageKey, d);
    } catch {
      /* ignore */
    }
  };
  return [density, update] as const;
}

export function DensityToggle({ value, onChange }: { value: TableDensity; onChange: (d: TableDensity) => void }) {
  return (
    <div role="radiogroup" aria-label="Row height" className="hidden h-9 items-center rounded-lg bg-muted p-0.5 md:inline-flex">
      {(["compact", "comfortable"] as const).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          onClick={() => onChange(d)}
          className={cn(
            "h-8 cursor-pointer rounded-md border-0 px-2.5 text-xs font-semibold capitalize transition-colors",
            value === d ? "bg-background text-primary shadow-card" : "bg-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
