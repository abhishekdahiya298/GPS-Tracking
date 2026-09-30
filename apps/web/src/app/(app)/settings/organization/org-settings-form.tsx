"use client";
import type { UnitSystem } from "@rio-gps/core";
import { dateFormatter, type TimeFormat } from "@rio-gps/core/timezones";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { TimeZoneSelect } from "@/components/app/time-zone-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";

interface Settings {
  unitSystem: UnitSystem;
  timeZone: string;
  timeFormat: TimeFormat;
}

export function OrgSettingsForm({ name, initial }: { name: string; initial: Settings }) {
  const router = useRouter();
  const [v, setV] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const patch = Object.fromEntries((Object.keys(v) as (keyof Settings)[]).filter((k) => v[k] !== initial[k]).map((k) => [k, v[k]]));
  const dirty = Object.keys(patch).length > 0;
  const preview = dateFormatter(v.timeZone, v.timeFormat);
  const now = Date.now();

  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Organization</CardTitle>
            <CardDescription>{name}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div>
            <p className="m-0 text-sm font-medium">Units</p>
            <p className="m-0 mb-2 text-sm text-muted-foreground">How speed and distance are shown in the app, reports, CSV exports and emails. Recorded GPS data is not changed.</p>
            <SegmentedFilter
              label="Units"
              value={v.unitSystem}
              onChange={(unitSystem) => setV({ ...v, unitSystem })}
              options={[
                { value: "imperial", label: "Miles · mph (US)" },
                { value: "metric", label: "Kilometres · km/h" }
              ]}
            />
          </div>

          <div>
            <label htmlFor="org-tz" className="m-0 text-sm font-medium">
              Time zone
            </label>
            <p id="org-tz-help" className="m-0 mb-2 text-sm text-muted-foreground">
              The default for everyone in your organization: screens, &quot;Today&quot; and date filters, trip reports, CSV exports and emails. People can choose their own
              under My account. Daylight saving time is applied automatically.
            </p>
            <TimeZoneSelect id="org-tz" aria-describedby="org-tz-help" className="max-w-md" value={v.timeZone} onChange={(e) => setV({ ...v, timeZone: e.target.value })} />
          </div>

          <div>
            <p className="m-0 text-sm font-medium">Clock</p>
            <p className="m-0 mb-2 text-sm text-muted-foreground">CSV exports always use 24-hour time.</p>
            <SegmentedFilter
              label="Clock"
              value={v.timeFormat}
              onChange={(timeFormat) => setV({ ...v, timeFormat })}
              options={[
                { value: "12h", label: "12-hour (3:45 PM)" },
                { value: "24h", label: "24-hour (15:45)" }
              ]}
            />
          </div>

          <p className="m-0 rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
            Preview: <span className="font-medium" suppressHydrationWarning>{preview.full(now)}</span>
          </p>
        </CardContent>
        <CardFooter>
          <Button
            disabled={!dirty}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api("/api/organization", { method: "PATCH", json: patch });
                toast.success("Settings saved.");
                router.refresh();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            Save changes
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
