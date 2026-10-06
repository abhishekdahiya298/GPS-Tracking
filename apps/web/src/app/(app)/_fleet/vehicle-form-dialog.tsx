"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { VehicleTypeIcon } from "@/components/app/vehicle-type-icon";
import { cn } from "@/lib/cn";
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

  async function submit(values: Values) {
    try {
      const body = VehicleInputSchema.parse(values);
      if (editing) await api(`/api/vehicles/${vehicle!.id}`, { method: "PATCH", json: body });
      else await api("/api/vehicles", { method: "POST", json: body });
      toast.success(editing ? "Vehicle updated." : `${body.name} added. Assign a GPS device to start tracking it.`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? "Edit vehicle" : "Add vehicle"} description={editing ? undefined : "Give it a name your team recognises, e.g. a truck number."}>
        <form method="post" noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
          <Field id="v-name" label="Name" required error={errors.name?.message}>
            <Input id="v-name" autoFocus aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "v-name-error" : undefined} {...form.register("name")} />
          </Field>
          <Field id="v-plate" label="License plate" description="Optional" error={errors.licensePlate?.message}>
            <Input id="v-plate" aria-invalid={Boolean(errors.licensePlate)} {...form.register("licensePlate")} />
          </Field>
          <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-sm font-medium">Type</legend>
            <div className="grid grid-cols-3 gap-2">
              {VEHICLE_TYPES.map((t) => (
                <label
                  key={t}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center text-xs transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    type === t ? "border-primary bg-primary-soft text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <input type="radio" value={t} className="sr-only" {...form.register("type")} />
                  <VehicleTypeIcon type={t} className={cn("size-6", type === t ? "text-primary [--vehicle-icon-gap:var(--color-primary-soft)]" : "")} />
                  {VEHICLE_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
            <p className="m-0 text-xs text-muted-foreground">Sets the icon shown on the map and in lists.</p>
          </fieldset>
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
