"use client";
import { Check, Database, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { DemoSeedResult } from "@/lib/demo-data";

const ROLE: Record<string, string> = { ORG_ADMIN: "Org Admin", FLEET_MANAGER: "Fleet Manager", DISPATCHER: "Dispatcher", VIEWER: "Viewer" };

/** Demo customers only: fill the demo carrier and the demo broker with test data (safe to run again). */
export function DemoDataButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DemoSeedResult | null>(null);
  async function run() {
    setBusy(true);
    try {
      setResult(await api<DemoSeedResult>("/api/admin/demo-data", { method: "POST" }));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="secondary" onClick={run} loading={busy}>
        <Database /> Fill demo data
      </Button>
      {result && (
        <Dialog open onOpenChange={(o) => !o && setResult(null)}>
          <DialogContent title="Demo data is ready" description={`${result.carrier.name} (carrier) and ${result.broker.name} (broker${result.broker.created ? ", new" : ""}). Running it again adds only what's missing, plus today's loads.`} className="sm:max-w-3xl">
            <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1 text-sm">
              <section className="grid gap-2">
                <h3 className="m-0 text-sm font-semibold">Logins</h3>
                <p className="m-0 text-xs text-muted-foreground">
                  <Mail className="mr-1 inline size-3.5" aria-hidden="true" />
                  New logins get an invitation email in the support inbox to set their own password.
                </p>
                <Table>
                  <THead>
                    <TR>
                      <TH>Email</TH>
                      <TH>Name</TH>
                      <TH>Company</TH>
                      <TH>Role</TH>
                      <TH>Invite</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.logins.map((l) => (
                      <TR key={`${l.company}-${l.email}`}>
                        <TD className="font-mono text-xs">{l.email}</TD>
                        <TD>{l.name}</TD>
                        <TD>{l.company}</TD>
                        <TD>{ROLE[l.role] ?? l.role}</TD>
                        <TD>{l.invited ? "Emailed now" : "Already set up"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
              <section className="grid gap-2">
                <h3 className="m-0 text-sm font-semibold">Drivers (driver app: sign in with the number; the code goes to the email)</h3>
                <Table>
                  <THead>
                    <TR>
                      <TH>Driver</TH>
                      <TH>Mobile</TH>
                      <TH>Email for codes</TH>
                      <TH>Truck</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {result.drivers.map((d) => (
                      <TR key={d.phone}>
                        <TD>{d.name}</TD>
                        <TD className="font-mono text-xs">{d.phone}</TD>
                        <TD className="font-mono text-xs">{d.email}</TD>
                        <TD>{d.truck ?? "Waiting to accept"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
              <section className="grid gap-2">
                <h3 className="m-0 text-sm font-semibold">Loads</h3>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {result.loads.map((l) => (
                    <li key={`${l.company}-${l.reference}`} className="flex gap-2">
                      {l.created ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> : <span className="size-4 shrink-0" />}
                      <span>
                        <b>{l.reference}</b> · {l.company} · {l.note}
                        {!l.created && " (already there)"}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <p className="m-0 text-xs text-muted-foreground">
                Zones: {result.zones.join(", ")}. Alert rules: {result.rules.join(", ")}.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setResult(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
