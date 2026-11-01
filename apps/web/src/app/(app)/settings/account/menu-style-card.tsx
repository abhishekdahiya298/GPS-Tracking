"use client";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { NAV_THEME_CLASSES, NAV_THEME_LABEL, NAV_THEMES, navTheme, type NavTheme } from "@/components/app/nav-themes";

/** Pick the side-menu style. Saved to the account, so it follows the person to any device. */
export function MenuStyleCard({ initial }: { initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState<NavTheme>(navTheme(initial));
  const [busy, setBusy] = useState<NavTheme | null>(null);

  async function choose(next: NavTheme) {
    if (next === value || busy) return;
    const prev = value;
    setValue(next);
    setBusy(next);
    try {
      await api("/api/account/preferences", { method: "PATCH", json: { navTheme: next } });
      router.refresh();
    } catch (err) {
      setValue(prev);
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Menu style</CardTitle>
      </CardHeader>
      <div role="radiogroup" aria-label="Menu style" className="grid grid-cols-1 gap-3 px-4 pb-4 pt-4 sm:grid-cols-3">
        {NAV_THEMES.map((k) => {
          const t = NAV_THEME_CLASSES[k];
          const on = value === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(k)}
              className={cn(
                "group grid gap-2 rounded-xl border bg-background p-2 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                on ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
              )}
            >
              {/* A small picture of the menu in this style. */}
              <span aria-hidden="true" className={cn("relative grid h-32 content-start gap-1.5 overflow-hidden rounded-lg p-2", t.root, "border-r-0")}>
                <span className={cn("block h-5 rounded-md", t.brandOuter)}>
                  <span className={cn("block h-full rounded-[5px]", t.brandInner)} />
                </span>
                <span className={cn("relative flex h-4 items-center gap-1 rounded px-1", t.active)}>
                  <span className={cn("absolute inset-y-0.5 left-0 w-0.5 rounded-r", t.accent)} />
                  <span className={cn("size-2 rounded-sm", t.tileActive)} />
                  <span className="h-1 w-8 rounded bg-current opacity-80" />
                </span>
                <span className={cn("grid gap-0.5 rounded-md p-0.5", t.group)}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={cn("flex h-3.5 items-center gap-1 rounded px-1", i > 0 && cn("border-t", t.divider), t.idle)}>
                      <span className={cn("size-2 rounded-sm", t.tileIdle)} />
                      <span className="h-1 w-10 rounded bg-current opacity-60" />
                    </span>
                  ))}
                </span>
              </span>
              <span className="flex items-start justify-between gap-2 px-0.5">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{NAV_THEME_LABEL[k].label}</span>
                  <span className="block text-xs text-muted-foreground">{NAV_THEME_LABEL[k].hint}</span>
                </span>
                <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border", on ? "border-primary bg-primary text-white" : "border-border")}>
                  {on && <Check className="size-3" aria-hidden="true" />}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
