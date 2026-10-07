"use client";
import { Inbox, Mail, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalTime } from "@/components/app/local-time";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { LeadDto } from "@/lib/leads";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/schemas/lead";

const TONE: Record<LeadStatus, "primary" | "success" | "neutral"> = { new: "primary", contacted: "success", closed: "neutral" };
const LABEL: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", closed: "Closed" };

export function LeadsView({ leads }: { leads: LeadDto[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(id: string, status: LeadStatus) {
    setBusy(id);
    try {
      await api(`/api/admin/leads/${id}`, { method: "PATCH", json: { status } });
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (leads.length === 0) {
    return (
      <Card>
        <EmptyState icon={Inbox} title="No pricing requests yet" description="Requests sent from the Get pricing form on the public site appear here, and are emailed to platform admins." />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="m-0 list-none divide-y divide-border p-0">
        {leads.map((l) => (
          <li key={l.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 truncate text-[15px] font-semibold">{l.company}</h2>
                <StatusBadge tone={TONE[l.status]} label={LABEL[l.status]} />
              </div>
              <p className="m-0 mt-0.5 text-sm text-muted-foreground">
                {l.name} · {l.fleetSize} vehicles · {l.country === "CA" ? "Canada" : "United States"} · <LocalTime iso={l.createdAt} />
              </p>
              <p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <a href={`mailto:${l.email}`} className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5" aria-hidden="true" /> {l.email}
                </a>
                {l.phone && (
                  <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5">
                    <Phone className="size-3.5" aria-hidden="true" /> {l.phone}
                  </a>
                )}
              </p>
              {l.message && <p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{l.message}</p>}
            </div>
            <Select aria-label={`Status of the request from ${l.company}`} className="w-full sm:w-36" value={l.status} disabled={busy === l.id} onChange={(e) => void setStatus(l.id, e.target.value as LeadStatus)}>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LABEL[s]}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Card>
  );
}
