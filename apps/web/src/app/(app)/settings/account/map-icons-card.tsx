"use client";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { iconName, type IconStyle } from "@/app/(app)/map/fleet-model";
import { useEffect, useState } from "react";
import { hasOwnMapIcons, resetMapIcons, saveMapIcons, useMapIcons } from "@/lib/map-icons";

const STYLES: ReadonlyArray<{ value: IconStyle; label: string }> = [
  { value: "photo", label: "Photo pin" },
  { value: "pin", label: "3D pin" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "top", label: "Live 3D" }
];

/** How vehicles look on the maps: the same icon library as the phone app. Saved in this browser. */
export function MapIconsCard() {
  const prefs = useMapIcons();
  const [own, setOwn] = useState(false);
  useEffect(() => setOwn(hasOwnMapIcons()), [prefs]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Map icons</CardTitle>
      </CardHeader>
      <div className="grid gap-3 px-4 pb-4 pt-4">
        <div role="radiogroup" aria-label="Map icon style" className="grid grid-cols-5 gap-2">
          {STYLES.map((s) => {
            const on = prefs.style === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => saveMapIcons({ style: s.value })}
                className={`flex flex-col items-center gap-1 rounded-lg border-2 px-2 py-2 text-xs font-semibold transition-colors ${on ? "border-primary bg-primary-soft text-primary" : "border-border bg-muted text-muted-foreground hover:border-input"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small static icon from /public */}
                <img src={`/fleet-art/map/icons/${iconName("truck", "moving", { style: s.value, color: prefs.color })}.png`} alt="" className="h-12 w-auto" />
                {s.label}
              </button>
            );
          })}
        </div>
        {prefs.style !== "top" ? (
          <SegmentedFilter
            label="Icon colour"
            value={prefs.color}
            onChange={(color) => saveMapIcons({ color })}
            options={[
              { value: "status", label: "By status" },
              { value: "type", label: "By vehicle type" }
            ]}
          />
        ) : null}
        <p className="text-sm text-muted-foreground">
          {own ? "Your own choice in this browser. " : "Using your company's default (Settings → Map display). "}
          Zoomed out, vehicles show as status dots. The phone app has its own setting.
          {own && (
            <>
              {" "}
              <button type="button" className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-primary underline-offset-2 hover:underline" onClick={() => resetMapIcons()}>
                Use the default
              </button>
            </>
          )}
        </p>
      </div>
    </Card>
  );
}
