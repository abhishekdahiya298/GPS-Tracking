"use client";
import { FEATURE_GROUPS, FEATURE_LABEL, LIMIT_LABEL, LIMITS, type Feature, type FeatureRule, type LimitKey, type PlanLimits } from "@rio-gps/core/plan-features";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { PlanDto, PlanVisibility } from "@/lib/plans";

type Draft = { locked: Set<Feature>; limits: PlanLimits; visibility: PlanVisibility; priceNote: string };
const VIS_LABEL: Record<PlanVisibility, string> = { public: "Public sign-up", offered: "Offered", hidden: "Hidden" };

const toDraft = (p: PlanDto): Draft => ({ locked: new Set(p.lockedFeatures), limits: { ...p.limits }, visibility: p.visibility, priceNote: p.priceNote ?? "" });
const same = (a: Draft, b: Draft) =>
  a.visibility === b.visibility &&
  a.priceNote === b.priceNote &&
  a.locked.size === b.locked.size &&
  [...a.locked].every((f) => b.locked.has(f)) &&
  LIMITS.every((k) => a.limits[k] === b.limits[k]);

/**
 * Rows = features and limits, columns = plans. Tick what each plan includes, type its limits
 * (empty = unlimited) and choose what customers without a feature see. Saving changes the
 * catalog only: customers keep their terms until their plan is changed.
 */
export function PlansMatrix({ plans, rules: initialRules }: { plans: PlanDto[]; rules: Record<Feature, FeatureRule> }) {
  const router = useRouter();
  const shown = plans.filter((p) => p.active);
  const initial = useMemo(() => Object.fromEntries(shown.map((p) => [p.id, toDraft(p)])), [shown]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(shown.map((p) => [p.id, toDraft(p)])));
  const [rules, setRules] = useState(initialRules);
  const [busy, setBusy] = useState(false);
  const changedPlans = shown.filter((p) => !same(drafts[p.id]!, initial[p.id]!));
  const rulesChanged = (Object.keys(rules) as Feature[]).some((f) => rules[f] !== initialRules[f]);
  const dirty = changedPlans.length > 0 || rulesChanged;

  const edit = (id: string, fn: (d: Draft) => Draft) => setDrafts((all) => ({ ...all, [id]: fn(all[id]!) }));
  const toggle = (id: string, f: Feature) =>
    edit(id, (d) => {
      const locked = new Set(d.locked);
      if (locked.has(f)) locked.delete(f);
      else locked.add(f);
      return { ...d, locked };
    });
  const setLimit = (id: string, k: LimitKey, raw: string) =>
    edit(id, (d) => {
      const limits = { ...d.limits };
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(n) || n < 0) delete limits[k];
      else limits[k] = Math.floor(n);
      return { ...d, limits };
    });

  async function save() {
    setBusy(true);
    try {
      for (const p of changedPlans) {
        const d = drafts[p.id]!;
        await api(`/api/admin/plans/${p.id}`, {
          method: "PATCH",
          json: {
            name: p.name,
            active: p.active,
            modules: p.modules,
            monthlyFee: p.monthlyFeeCents / 100,
            perTracker: p.perTrackerCents / 100,
            includedLoads: p.includedLoads,
            extraLoad: p.extraLoadCents / 100,
            lockedFeatures: [...d.locked],
            limits: Object.fromEntries(LIMITS.map((k) => [k, d.limits[k] ?? ""])),
            visibility: d.visibility,
            priceNote: d.priceNote
          }
        });
      }
      if (rulesChanged) await api("/api/admin/feature-rules", { method: "PUT", json: rules });
      toast.success("Plans saved. Existing customers keep their terms until you change their plan.");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <b>What each plan includes</b>
          <p className="m-0 text-xs text-muted-foreground">
            {shown.length} plans · {FEATURE_GROUPS.reduce((n, g) => n + g.features.length, 0)} features · empty limit = unlimited
          </p>
        </div>
        <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
          <Save /> Save changes
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-left align-bottom">
              <th className="sticky left-0 z-10 min-w-[210px] bg-muted/60 px-4 py-2.5 font-semibold">Feature</th>
              <th className="min-w-[160px] px-3 py-2.5 font-semibold">When not in plan</th>
              {shown.map((p) => (
                <th key={p.id} title={p.visibility === "hidden" ? "Console only: customers never see it" : p.visibility === "public" ? "New sign-ups can start on it" : "Shown to customers on their Plan page"} className={cn("min-w-[130px] px-3 py-2.5 text-center", changedPlans.includes(p) && "bg-primary/10")}>
                  <div className="font-bold">{p.name}</div>
                  <Select
                    aria-label={`Who sees ${p.name}`}
                    className="mt-1 h-7 w-full text-xs"
                    value={drafts[p.id]!.visibility}
                    onChange={(e) => edit(p.id, (d) => ({ ...d, visibility: e.target.value as PlanVisibility }))}
                  >
                    {(Object.keys(VIS_LABEL) as PlanVisibility[]).map((v) => (
                      <option key={v} value={v}>
                        {VIS_LABEL[v]}
                      </option>
                    ))}
                  </Select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_GROUPS.map((g) => (
              <FeatureGroup key={g.title} title={g.title} span={shown.length + 2}>
                {g.features.map((f) => (
                  <tr key={f} className="border-t border-border hover:bg-muted/30">
                    <th scope="row" className="sticky left-0 z-10 bg-background px-4 py-2 text-left font-medium">
                      {FEATURE_LABEL[f]}
                    </th>
                    <td className="px-3 py-1.5">
                      <Select aria-label={`When ${FEATURE_LABEL[f]} isn't in the plan`} className="h-8 min-w-[140px] text-xs" value={rules[f]} onChange={(e) => setRules((r) => ({ ...r, [f]: e.target.value as FeatureRule }))}>
                        <option value="lock">Show with lock</option>
                        <option value="hide">Hide</option>
                      </Select>
                    </td>
                    {shown.map((p) => (
                      <td key={p.id} className="px-3 py-1.5 text-center">
                        <Checkbox aria-label={`${p.name}: ${FEATURE_LABEL[f]}`} checked={!drafts[p.id]!.locked.has(f)} onChange={() => toggle(p.id, f)} className="size-5" />
                      </td>
                    ))}
                  </tr>
                ))}
              </FeatureGroup>
            ))}
            <FeatureGroup title="Limits" span={shown.length + 2} note="empty = unlimited">
              {LIMITS.map((k) => (
                <tr key={k} className="border-t border-border">
                  <th scope="row" className="sticky left-0 z-10 bg-background px-4 py-2 text-left font-medium">
                    {LIMIT_LABEL[k]}
                  </th>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{k === "historyDays" ? "Older trips hidden" : "Upgrade at limit"}</td>
                  {shown.map((p) => (
                    <td key={p.id} className="px-3 py-1.5">
                      <Input
                        aria-label={`${p.name}: ${LIMIT_LABEL[k]}`}
                        inputMode="numeric"
                        className="h-8 text-center tabular-nums"
                        placeholder="∞"
                        value={drafts[p.id]!.limits[k] ?? ""}
                        onChange={(e) => setLimit(p.id, k, e.target.value.replace(/[^\d]/g, ""))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </FeatureGroup>
            <FeatureGroup title="Price" span={shown.length + 2} note="copied to each customer">
              <tr className="border-t border-border">
                <th scope="row" className="sticky left-0 z-10 bg-background px-4 py-2 text-left font-medium">
                  Shown as
                </th>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">Empty = prices</td>
                {shown.map((p) => (
                  <td key={p.id} className="px-3 py-1.5">
                    <Input aria-label={`${p.name}: price text`} className="h-8 text-center text-xs" maxLength={40} placeholder={priceText(p)} value={drafts[p.id]!.priceNote} onChange={(e) => edit(p.id, (d) => ({ ...d, priceNote: e.target.value }))} />
                  </td>
                ))}
              </tr>
            </FeatureGroup>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FeatureGroup({ title, note, span, children }: { title: string; note?: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-primary/5">
        <td colSpan={span} className="sticky left-0 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-primary">
          {title}
          {note && <span className="ml-2 font-medium normal-case tracking-normal text-muted-foreground">· {note}</span>}
        </td>
      </tr>
      {children}
    </>
  );
}

function priceText(p: PlanDto): string {
  const m = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
  if (p.monthlyFeeCents === 0 && p.perTrackerCents === 0 && p.extraLoadCents === 0) return "$0";
  return [p.monthlyFeeCents > 0 ? `${m(p.monthlyFeeCents)}/mo` : null, p.perTrackerCents > 0 ? `${m(p.perTrackerCents)}/tracker` : null].filter(Boolean).join(" + ") || "—";
}
