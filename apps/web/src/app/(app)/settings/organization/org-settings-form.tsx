"use client";
import type { UnitSystem } from "@rio-gps/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";

export function OrgSettingsForm({ name, initialUnits }: { name: string; initialUnits: UnitSystem }) {
  const router = useRouter();
  const [unitsValue, setUnits] = useState<UnitSystem>(initialUnits);
  const [saving, setSaving] = useState(false);
  const dirty = unitsValue !== initialUnits;
  return (
    <div className="grid max-w-2xl gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Organization</CardTitle>
            <CardDescription>{name}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div>
            <p className="m-0 text-sm font-medium" id="units-label">
              Units
            </p>
            <p className="m-0 mb-2 text-sm text-muted-foreground">How speed and distance are shown in the app, reports, CSV exports and emails. Recorded GPS data is not changed.</p>
            <SegmentedFilter
              label="Units"
              value={unitsValue}
              onChange={setUnits}
              options={[
                { value: "imperial", label: "Miles · mph (US)" },
                { value: "metric", label: "Kilometres · km/h" }
              ]}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            disabled={!dirty}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api("/api/organization", { method: "PATCH", json: { unitSystem: unitsValue } });
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
