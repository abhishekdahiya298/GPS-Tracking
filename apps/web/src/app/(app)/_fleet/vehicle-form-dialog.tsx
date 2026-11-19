"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { VehiclePicture } from "@/components/app/vehicle-picture";
import { cn } from "@/lib/cn";
import { deviceDisplayName } from "@/lib/device-name";
import { asVehicleType, DEFAULT_VEHICLE_TYPE, VEHICLE_TYPE_LABEL, VEHICLE_TYPES, VehicleInputSchema } from "@/lib/schemas/vehicle";

type Values = z.input<typeof VehicleInputSchema>;
export interface EditableVehicle {
  id: string;
  name: string;
  licensePlate: string | null;
  type?: string;
  vehicleStatus: string;
}

/** Add / edit vehicle. Same zod schema as the API; the server stays authoritative. */
export function VehicleFormDialog({ open, onOpenChange, vehicle, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; vehicle?: EditableVehicle | null; onSaved: () => void }) {
  const editing = Boolean(vehicle);
  const form = useForm<Values>({
    resolver: zodResolver(VehicleInputSchema),
    values: { name: vehicle?.name ?? "", licensePlate: vehicle?.licensePlate ?? "", status: (vehicle?.vehicleStatus as Values["status"]) ?? "active", type: vehicle ? asVehicleType(vehicle.type ?? DEFAULT_VEHICLE_TYPE) : DEFAULT_VEHICLE_TYPE }
  });
  const { errors, isSubmitting } = form.formState;
  const type = form.watch("type") ?? DEFAULT_VEHICLE_TYPE;
  // Adding a vehicle: offer the GPS devices not on a vehicle yet, so it is tracked in one step.
  const [freeDevices, setFreeDevices] = useState<{ id: string; label: string; imeiLast4?: string }[] | null>(null);
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    if (!open || editing) return;
    let live = true;
    api<{ items: { id: string; name: string | null; model: string | null; imeiLast4?: string }[] }>(`/api/devices?${new URLSearchParams({ state: "unassigned", pageSize: "100", sort: "name" })}`)
      .then((r) => {
        if (!live) return;
        const list = r.items.map((d) => ({ id: d.id, label: deviceDisplayName(d.name, d.model), imeiLast4: d.imeiLast4 }));
        setFreeDevices(list);
        setDeviceId(list.length === 1 ? list[0]!.id : "");
      })
      .catch(() => live && setFreeDevices([]));
    return () => {
      live = false;
    };
  }, [open, editing]);

  async function submit(values: Values) {
    try {
      const body = VehicleInputSchema.parse(values);
      if (editing) {
        await api(`/api/vehicles/${vehicle!.id}`, { method: "PATCH", json: body });
        toast.success("Vehicle updated.");
      } else {
        const out = await api<{ vehicle: { id: string } }>("/api/vehicles", { method: "POST", json: body });
        if (deviceId) {
          try {
            await api(`/api/devices/${deviceId}/assignment`, { method: "PUT", json: { vehicleId: out.vehicle.id } });
            toast.success(`${body.name} added and tracking with its GPS device.`);
          } catch (err) {
            toast.error(`${body.name} added, but the device could not be assigned: ${errorMessage(err)}`);
          }
        } else toast.success(`${body.name} added. Assign a GPS device to start tracking it.`);
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? "Edit vehicle" : "Add vehicle"} description={editing ? undefined : "Give it a name your team recognises, e.g. a truck number."} className="max-w-2xl">
        <form method="post" noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field id="v-name" label="Name" required error={errors.name?.message}>
              <Input id="v-name" autoFocus placeholder="e.g. TRUCK-210" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "v-name-error" : undefined} {...form.register("name")} />
            </Field>
            <Field id="v-plate" label="License plate" error={errors.licensePlate?.message}>
              <Input id="v-plate" placeholder="Optional" aria-invalid={Boolean(errors.licensePlate)} {...form.register("licensePlate")} />
            </Field>
          </div>
          <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-sm font-medium">Type</legend>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {VEHICLE_TYPES.map((t) => (
                <label
                  key={t}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-center text-[11px] leading-tight transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    type === t ? "border-primary bg-primary-soft text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <input type="radio" value={t} className="sr-only" {...form.register("type")} />
                  <VehiclePicture type={t} state="moving" className="h-8 w-11" />
                  {VEHICLE_TYPE_LABEL[t]}
                </label>
              ))}
            </div>

          </fieldset>
          {!editing && freeDevices && freeDevices.length > 0 && (
            <Field id="v-device" label="GPS device" description={`${freeDevices.length} free device${freeDevices.length === 1 ? "" : "s"}. You can also assign one later.`}>
              <Select id="v-device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">No device for now</option>
                {freeDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                    {d.imeiLast4 ? ` · IMEI …${d.imeiLast4}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {editing && (
            <Field id="v-status" label="Status">
              <Select id="v-status" {...form.register("status")}>
                <option value="active">Active</option>
                <option value="maintenance">In maintenance</option>
                <option value="inactive">Inactive</option>
              </Select>
            </Field>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? "Save changes" : "Add vehicle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
