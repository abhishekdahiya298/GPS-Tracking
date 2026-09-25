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
import { VehicleInputSchema } from "@/lib/schemas/vehicle";

type Values = z.input<typeof VehicleInputSchema>;
export interface EditableVehicle {
  id: string;
  name: string;
  licensePlate: string | null;
  vehicleStatus: string;
}

/** Add / edit vehicle. Same zod schema as the API; the server stays authoritative. */
export function VehicleFormDialog({ open, onOpenChange, vehicle, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; vehicle?: EditableVehicle | null; onSaved: () => void }) {
  const editing = Boolean(vehicle);
  const form = useForm<Values>({
    resolver: zodResolver(VehicleInputSchema),
    values: { name: vehicle?.name ?? "", licensePlate: vehicle?.licensePlate ?? "", status: (vehicle?.vehicleStatus as Values["status"]) ?? "active" }
  });
  const { errors, isSubmitting } = form.formState;

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
