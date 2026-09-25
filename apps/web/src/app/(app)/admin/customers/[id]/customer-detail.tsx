"use client";
import { Cpu, Eye, Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { CustomerDetail } from "@/lib/customers";
import { viewAs } from "../_shared/view-as";

const ROLE_LABEL: Record<string, string> = { ORG_ADMIN: "Org Admin", FLEET_MANAGER: "Fleet Manager", DISPATCHER: "Dispatcher", VIEWER: "Viewer" };
const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function CustomerDetailView({ c }: { c: CustomerDetail }) {
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.slug} · created ${new Date(c.createdAt).toLocaleDateString()}`}
        breadcrumbs={[{ label: "Customers", href: "/admin/customers" }, { label: c.name }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => viewAs(c.id)}>
              <Eye /> View as customer
            </Button>
            <Button onClick={() => setRegistering(true)}>
              <Plus /> Register device
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Devices ({c.devices.length})</CardTitle>
          </CardHeader>
          {c.devices.length === 0 ? (
            <EmptyState
              icon={Cpu}
              title="No devices yet"
              description="Register the tracker's IMEI. It's added to Traccar and to this customer. Then point the device at tracker.riocaliforniainc.com:5027."
              action={
                <Button size="sm" onClick={() => setRegistering(true)}>
                  <Plus /> Register device
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Device</TH>
                  <TH>Vehicle</TH>
                  <TH>Status</TH>
                  <TH>Last seen</TH>
                </TR>
              </THead>
              <TBody>
                {c.devices.map((d) => (
                  <TR key={d.id}>
                    <TD>
                      <div className="font-medium">{d.name ?? d.model ?? "Device"}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.model ?? "—"} · IMEI …{d.imeiLast4}
                      </div>
                    </TD>
                    <TD>{d.vehicleName ?? <span className="text-muted-foreground">Unassigned</span>}</TD>
                    <TD>{d.status === "active" ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label={d.status === "retired" ? "Retired" : "Deactivated"} />}</TD>
                    <TD className="whitespace-nowrap">{ago(d.lastSeenAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Users ({c.members.length})</CardTitle>
          </CardHeader>
          {c.members.length === 0 ? (
            <EmptyState icon={Users} title="No users" />
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {c.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{m.name}</div>
                    <div className="break-all text-xs text-muted-foreground">{m.email}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <div>{ROLE_LABEL[m.role] ?? m.role}</div>
                    <div className="text-muted-foreground">{m.lastSignInAt ? `Active ${ago(m.lastSignInAt)}` : "Invited"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">To add or change users, use View as customer → Team.</p>
        </Card>
      </div>
      <RegisterDeviceDialog
        open={registering}
        onOpenChange={setRegistering}
        customerId={c.id}
        onDone={() => router.refresh()}
      />
    </>
  );
}

function RegisterDeviceDialog({ open, onOpenChange, customerId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; customerId: string; onDone: () => void }) {
  const [imei, setImei] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = imei.replace(/\D/g, "");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const name = String(f.get("name") ?? "").trim();
      const out = await api<{ traccarCreated: boolean }>(`/api/admin/customers/${customerId}/devices`, { method: "POST", json: { imei: digits, model: f.get("model"), ...(name ? { name } : {}) } });
      toast.success(out.traccarCreated ? "Device registered in Traccar and RIO." : "Device already existed in Traccar; linked to this customer.");
      setImei("");
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title="Register a GPS device" description="Adds the IMEI to Traccar (if it isn't there) and assigns it to this customer. Nothing is saved if Traccar rejects it.">
        <form method="post" onSubmit={submit} className="grid gap-4">
          <Field id="rd-imei" label="IMEI" required description="15 digits, printed on the device label." error={digits.length > 0 && digits.length !== 15 ? `${digits.length} of 15 digits` : null}>
            <Input id="rd-imei" value={imei} onChange={(e) => setImei(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={20} aria-invalid={digits.length > 0 && digits.length !== 15} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="rd-model" label="Model" required>
              <Input id="rd-model" name="model" defaultValue="FTM880" required maxLength={60} />
            </Field>
            <Field id="rd-name" label="Name" description="Optional, e.g. Truck 7 tracker">
              <Input id="rd-name" name="name" maxLength={80} />
            </Field>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={digits.length !== 15}>
              Register device
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
