"use client";
import { MapPinned } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { iconName } from "@/app/(app)/map/fleet-model";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { refreshCompanyIcons } from "@/lib/map-icons";
import type { OrgMapPrefs } from "@/lib/org-map-prefs";

const STYLES: { value: OrgMapPrefs["iconStyle"]; label: string; hint: string }[] = [
  { value: "photo", label: "3D photo", hint: "Recommended" },
  { value: "pin", label: "3D pin", hint: "Classic" },
  { value: "circle", label: "Circle", hint: "Compact" },
  { value: "square", label: "Square", hint: "Compact" },
  { value: "top", label: "Top view", hint: "Turns with road" }
];

const TOGGLES: { key: "labels" | "nearby" | "cluster" | "zones"; label: string; hint: string }[] = [
  { key: "labels", label: "Vehicle names", hint: "Name and speed under each icon" },
  { key: "nearby", label: "Nearby vehicle chips", hint: "Off-screen vehicles at the map edges" },
  { key: "cluster", label: "Group vehicles when zoomed out", hint: "Count bubbles for fleets over 60 vehicles" },
  { key: "zones", label: "Zones", hint: "Your yards and customer sites" }
];

/** Company-wide map look: everyone in the company sees these on the web and dashboard maps. */
export function MapDisplayCard({ initial }: { initial: OrgMapPrefs }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <MapPinned className="size-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle>Map display</CardTitle>
            <CardDescription>How vehicles look on your company&apos;s maps. Applies to everyone in the company.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div role="radiogroup" aria-label="Vehicle icon style" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {STYLES.map((s) => {
            const on = v.iconStyle === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setV({ ...v, iconStyle: s.value })}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 bg-background px-2 py-3 text-center transition-all",
                  on ? "border-primary bg-primary-soft shadow-card" : "border-border hover:border-input"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- small static icon */}
                <img src={`/fleet-art/map/icons/${iconName("semi", "moving", { style: s.value, color: v.iconColor })}.png`} alt="" className="h-14 w-auto" />
                <span className={cn("text-[13px] font-semibold", on ? "text-primary" : "text-foreground")}>{s.label}</span>
                <span className="text-[11px] text-muted-foreground">{s.hint}</span>
              </button>
            );
          })}
        </div>
        {v.iconStyle !== "photo" && v.iconStyle !== "top" && (
          <SegmentedFilter
            label="Icon colour"
            value={v.iconColor}
            onChange={(iconColor) => setV({ ...v, iconColor })}
            options={[
              { value: "status", label: "By status" },
              { value: "type", label: "By vehicle type" }
            ]}
          />
        )}
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {TOGGLES.map((t) => (
            <li key={t.key} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{t.hint}</span>
              </span>
              <Switch checked={v[t.key]} onCheckedChange={(on) => setV({ ...v, [t.key]: on })} label={t.label} />
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {dirty && (
          <Button variant="secondary" onClick={() => setV(initial)} disabled={saving}>
            Reset
          </Button>
        )}
        <Button
          disabled={!dirty}
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api("/api/organization", { method: "PATCH", json: { mapPrefs: v } });
              toast.success("Map display saved for everyone in your company");
              router.refresh();
              setTimeout(refreshCompanyIcons, 300);
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setSaving(false);
            }
          }}
        >
          Save map display
        </Button>
      </CardFooter>
    </Card>
  );
}
