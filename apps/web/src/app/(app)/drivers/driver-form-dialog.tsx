"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { DriverRow } from "@/lib/drivers";
import { asVehicleType, VEHICLE_TYPE_LABEL } from "@/lib/schemas/vehicle";

export interface VehicleOption {
  id: string;
  name: string;
  type: string;
  licensePlate: string | null;
  /** Who drives it now (null when free). */
  driver: string | null;
}

/** Add / edit a driver in one compact two-column form that fits without scrolling. */
export function DriverFormDialog({ open, onOpenChange, driver, vehicles, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; driver: DriverRow | null; vehicles: VehicleOption[]; onSaved: () => void }) {
  const editing = Boolean(driver);
  const [v, setV] = useState({
    name: driver?.name ?? "",
    phone: driver?.phone ?? "",
    email: driver?.email ?? "",
    licenseNumber: driver?.licenseNumber ?? "",
    licenseExpiresOn: driver?.licenseExpiresOn ?? "",
    vehicleId: driver?.vehicle?.id ?? "",
    status: driver?.status ?? "active",
    notes: driver?.notes ?? ""
  });
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const field = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value })) });
  const taken = vehicles.find((x) => x.id === v.vehicleId && x.driver && x.driver !== driver?.name);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return setNameError("Enter the driver's name");
    setBusy(true);
    try {
      if (editing) await api(`/api/drivers/${driver!.id}`, { method: "PATCH", json: v });
      else await api("/api/drivers", { method: "POST", json: v });
      toast.success(editing ? "Driver saved" : `${v.name.trim()} added`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={editing ? `Edit ${driver!.name}` : "Add driver"} description={editing ? undefined : "Their name shows on the live map, the vehicle and its trips."} className="max-w-2xl">
        <form noValidate onSubmit={submit} className="grid gap-4">
          <div className="grid items-start gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field id="d-name" label="Full name" required error={nameError}>
              <Input id="d-name" autoFocus maxLength={120} aria-invalid={Boolean(nameError)} {...field("name")} onInput={() => setNameError(null)} />
            </Field>
            <Field id="d-phone" label="Phone">
              <Input id="d-phone" type="tel" inputMode="tel" maxLength={40} placeholder="+1 555 010 2030" {...field("phone")} />
            </Field>
            <Field id="d-vehicle" label="Vehicle they drive" description={taken ? `${taken.driver} drives it now; saving moves it here.` : undefined}>
              <Select id="d-vehicle" {...field("vehicleId")}>
                <option value="">No vehicle</option>
                {vehicles.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {VEHICLE_TYPE_LABEL[asVehicleType(x.type)]}
                    {x.licensePlate ? ` · ${x.licensePlate}` : ""}
                    {x.driver && x.driver !== driver?.name ? ` (now: ${x.driver})` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="d-email" label="Email">
              <Input id="d-email" type="email" maxLength={200} {...field("email")} />
            </Field>
            <Field id="d-license" label="Licence number">
              <Input id="d-license" maxLength={60} {...field("licenseNumber")} />
            </Field>
            <Field id="d-expiry" label="Licence expires">
              <Input id="d-expiry" type="date" {...field("licenseExpiresOn")} />
            </Field>
            <Field id="d-notes" label="Notes" className="sm:col-span-2">
              <Textarea id="d-notes" rows={2} maxLength={2000} {...field("notes")} />
            </Field>
            {editing && (
              <Field id="d-status" label="Status">
                <Select id="d-status" {...field("status")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive (left the company)</option>
                </Select>
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {editing ? "Save driver" : "Add driver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
