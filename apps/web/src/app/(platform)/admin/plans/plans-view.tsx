"use client";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { MODULE_LABEL, termsSummary } from "@/lib/plan-format";
import type { PlanDto } from "@/lib/plans";
import { FormDialog, type FieldSpec, type FormValues } from "../_shared/form-dialog";

const dollars = (cents: number) => (cents / 100).toFixed(2);

function planFields(p: PlanDto | null): FieldSpec[] {
  return [
    { name: "name", label: "Plan name", kind: "text", required: true, maxLength: 60, defaultValue: p?.name ?? "", placeholder: "e.g. Loads Pro" },
    { name: "gps", label: "GPS tracking", kind: "checkbox", defaultValue: p ? p.modules.includes("gps") : true, description: "Live map, vehicles, trackers, trips, zones, reports, maintenance." },
    { name: "loads", label: "Loads", kind: "checkbox", defaultValue: p ? p.modules.includes("loads") : true, description: "Broker loads tracked by the driver's phone (or the customer's own trucks when GPS is included)." },
    { name: "monthlyFee", label: "Monthly fee ($)", kind: "money", defaultValue: dollars(p?.monthlyFeeCents ?? 0), half: true },
    { name: "perTracker", label: "Per tracker per month ($)", kind: "money", defaultValue: dollars(p?.perTrackerCents ?? 0), half: true, description: "GPS plans." },
    { name: "includedLoads", label: "Loads included per month", kind: "text", numeric: true, defaultValue: String(p?.includedLoads ?? 0), half: true, description: "0 = every load is billed." },
    { name: "extraLoad", label: "Price per extra load ($)", kind: "money", defaultValue: dollars(p?.extraLoadCents ?? 0), half: true },
    { name: "active", label: "Offered to new customers", kind: "checkbox", defaultValue: p?.active ?? true }
  ];
}

const body = (v: FormValues) => ({
  name: v.name,
  modules: [v.gps && "gps", v.loads && "loads"].filter(Boolean),
  monthlyFee: v.monthlyFee || 0,
  perTracker: v.perTracker || 0,
  includedLoads: v.includedLoads || 0,
  extraLoad: v.extraLoad || 0,
  active: Boolean(v.active)
});

export function PlansView({ plans }: { plans: PlanDto[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PlanDto | "new" | null>(null);
  const current = editing === "new" ? null : editing;

  return (
    <>
      <PageHeader
        title="Plans"
        description="What RIO GPS sells. A customer's price is copied from the plan when you assign it, so editing a plan here never changes what existing customers pay."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden="true" /> New plan
          </Button>
        }
      />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Plan</TH>
              <TH>Includes</TH>
              <TH>Price</TH>
              <TH className="text-right">Customers</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {plans.map((p) => (
              <TR key={p.id} className={p.active ? undefined : "opacity-60"}>
                <TD>
                  <div className="font-medium">{p.name}</div>
                  {!p.active && <StatusBadge tone="neutral" label="Not offered" className="mt-1" />}
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {p.modules.map((m) => (
                      <StatusBadge key={m} tone={m === "gps" ? "info" : "success"} label={MODULE_LABEL[m]} />
                    ))}
                  </div>
                </TD>
                <TD className="text-sm">
                  {termsSummary(p).map((t) => (
                    <div key={t}>{t}</div>
                  ))}
                </TD>
                <TD className="text-right tabular-nums">{p.customers}</TD>
                <TD className="w-0 text-right">
                  <IconButton label={`Edit ${p.name}`} size="icon-sm" variant="ghost" onClick={() => setEditing(p)}>
                    <Pencil className="size-4" />
                  </IconButton>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      {editing && (
        <FormDialog
          title={current ? `Edit ${current.name}` : "New plan"}
          intro={
            current && current.customers > 0 ? (
              <Alert tone="info">
                {current.customers} {current.customers === 1 ? "customer is" : "customers are"} on this plan and keep their current price. To move them to the new price, change their plan on their customer page.
              </Alert>
            ) : undefined
          }
          fields={planFields(current)}
          confirmLabel={current ? "Save plan" : "Create plan"}
          onOpenChange={(o) => !o && setEditing(null)}
          onSubmit={async (v) => {
            if (current) await api(`/api/admin/plans/${current.id}`, { method: "PATCH", json: body(v) });
            else await api("/api/admin/plans", { method: "POST", json: body(v) });
            toast.success(current ? "Plan saved" : "Plan created");
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
