"use client";
import { Package, Search, Smartphone, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { LoadSummaryDto } from "@/lib/loads";

const STATUS: Record<string, string> = { invited: "Waiting for driver", tracking: "Tracking", at_pickup: "At pickup", in_transit: "In transit", at_delivery: "At delivery" };

/** What the dialog needs to know about the driver. */
export interface AssignTarget {
  name: string;
  phone: string | null;
  vehicle: { id: string; name: string } | null;
  /** The driver's truck has a RIO tracker that reports. */
  hasTracker: boolean;
}

/**
 * One Assign dialog (A37, A38): pick an open load for this driver. Your own driver needs no Accept;
 * the load shows in their app right away. Before pickup, the load follows the driver's truck
 * tracker when they have one, otherwise their phone.
 */
export function AssignLoadDialog({ driver, onClose, onDone }: { driver: AssignTarget; onClose: () => void; onDone: () => void }) {
  const [loads, setLoads] = useState<LoadSummaryDto[] | null>(null);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ loads: LoadSummaryDto[] }>("/api/loads?filter=active")
      .then((r) => setLoads(r.loads))
      .catch((err) => {
        toast.error(errorMessage(err));
        setLoads([]);
      });
  }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (loads ?? []).filter((l) => !s || [l.reference, l.pickup.name, l.pickup.address, l.delivery.name, l.delivery.address, l.driverName].some((v) => v?.toLowerCase().includes(s)));
  }, [loads, q]);
  const chosen = loads?.find((l) => l.id === pick) ?? null;
  // Before pickup the load can switch to what this driver has: the truck's tracker, else the phone.
  const canSwitch = chosen ? ["invited", "tracking"].includes(chosen.status) : false;
  const follow: "vehicle" | "phone" | null = !chosen ? null : canSwitch ? (driver.vehicle && driver.hasTracker ? "vehicle" : driver.phone ? "phone" : chosen.trackingMode) : chosen.trackingMode;
  const vehicleBlocked = follow === "vehicle" && !driver.vehicle;

  async function assign() {
    if (!chosen) return;
    setBusy(true);
    try {
      const json: Record<string, unknown> = { driverName: driver.name };
      if (driver.phone) json.driverPhone = driver.phone;
      if (follow && follow !== chosen.trackingMode) json.trackingMode = follow;
      if (follow === "vehicle" && driver.vehicle) json.vehicleId = driver.vehicle.id;
      await api(`/api/loads/${chosen.id}`, { method: "PATCH", json });
      toast.success(`${chosen.reference} assigned to ${driver.name}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Assign a load to ${driver.name}`} description="Your own driver doesn't need to accept: the load shows in their app right away." className="sm:max-w-lg">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search load number or place…" aria-label="Search loads" className="pl-9" />
        </div>
        <div className="grid max-h-[340px] gap-2 overflow-y-auto pr-1" role="radiogroup" aria-label="Open loads">
          {loads === null && <p className="m-0 py-6 text-center text-sm text-muted-foreground">Loading open loads…</p>}
          {loads !== null && shown.length === 0 && (
            <div className="grid justify-items-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <Package className="size-6" aria-hidden="true" />
              {loads.length === 0 ? "No open loads." : "No loads match."}
              <Link href="/loads" className="font-semibold text-primary">
                Create a load
              </Link>
            </div>
          )}
          {shown.map((l) => {
            const taken = l.driverName && l.driverName !== driver.name;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={pick === l.id}
                onClick={() => setPick(l.id)}
                className={cn("grid gap-1 rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/60", pick === l.id ? "border-primary ring-2 ring-primary/25" : "border-border")}
              >
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{l.reference}</span>
                  <span className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] font-semibold text-muted-foreground">{STATUS[l.status] ?? l.status}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    {l.trackingMode === "vehicle" ? <Truck className="size-3.5" aria-hidden="true" /> : <Smartphone className="size-3.5" aria-hidden="true" />}
                    {l.trackingMode === "vehicle" ? "Truck tracker" : "Driver's phone"}
                  </span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {l.pickup.name ?? l.pickup.address} → {l.delivery.name ?? l.delivery.address}
                </span>
                {taken && <span className="text-[11px] font-semibold text-warning">Now with {l.driverName}. Assigning moves it.</span>}
              </button>
            );
          })}
        </div>
        {chosen && follow && !vehicleBlocked && !(follow === "phone" && !driver.phone) && (
          <p className="m-0 flex items-start gap-2 rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary">
            {follow === "vehicle" ? <Truck className="mt-px size-3.5 shrink-0" aria-hidden="true" /> : <Smartphone className="mt-px size-3.5 shrink-0" aria-hidden="true" />}
            <span>
              {follow === "vehicle"
                ? `${driver.name} drives ${driver.vehicle?.name ?? "a truck"}, so this load follows the truck's tracker. The phone is the backup.`
                : `${driver.name} has no truck tracker, so this load follows ${driver.name.split(" ")[0]}'s phone.`}
            </span>
          </p>
        )}
        {vehicleBlocked && <p className="m-0 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">This load follows a truck&apos;s tracker and is already under way. Give {driver.name} a truck first, or pick another load.</p>}
        {follow === "phone" && !driver.phone && <p className="m-0 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">Add {driver.name}&apos;s mobile number first: this load is tracked by phone.</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={assign} loading={busy} disabled={!chosen || vehicleBlocked || (follow === "phone" && !driver.phone)}>
            Assign load
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
