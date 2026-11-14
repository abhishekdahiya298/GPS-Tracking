"use client";
import { useState } from "react";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { applyTheme, type ThemeChoice } from "@/lib/theme";

/** Light, dark, or follow the computer. Saved in this browser and applied at once. */
export function AppearanceCard({ initial }: { initial: ThemeChoice }) {
  const [value, setValue] = useState<ThemeChoice>(initial);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <div className="grid gap-2 px-4 pb-4 pt-4">
        <SegmentedFilter
          label="Appearance"
          value={value}
          onChange={(v) => {
            setValue(v);
            applyTheme(v);
          }}
          options={[
            { value: "system", label: "Same as this computer" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" }
          ]}
        />
        <p className="text-sm text-muted-foreground">Applies to this browser. The phone app has its own setting.</p>
      </div>
    </Card>
  );
}
