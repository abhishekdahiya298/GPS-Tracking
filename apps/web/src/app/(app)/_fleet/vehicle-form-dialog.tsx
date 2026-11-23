"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheck, Info, Search, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { useUnits } from "@/components/app/units-context";
import { api, errorMessage } from "@/lib/client/api";
import { VehiclePicture } from "@/components/app/vehicle-picture";
import { cn } from "@/lib/cn";
import { deviceDisplayName } from "@/lib/device-name";
import type { VehicleDetail } from "@/lib/fleet-list";
import type { VinInfo } from "@/lib/vin-decode";
import { asVehicleType, DEFAULT_VEHICLE_TYPE, FUEL_LABEL, FUEL_TYPES, normalizeVin, VEHICLE_TYPE_LABEL, VEHICLE_TYPES, VehicleInputSchema, VIN_RE, vinProblem } from "@/lib/schemas/vehicle";

type Values = z.input<typeof VehicleInputSchema>;
export interface EditableVehicle {
  id: string;
  name: string;
  licensePlate: string | null;
  type?: string;
  vehicleStatus: string;
}

const blank = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/**
 * Add / edit vehicle in one wide dialog: what's needed on the left, optional details
 * (VIN with look-up, year/make/model, odometer…) on the right. Same zod schema as the
 * API; the server stays authoritative.
 */
export function VehicleFormDialog({ open, onOpenChange, vehicle, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; vehicle?: EditableVehicle | null; onSaved: () => void }) {
  const editing = Boolean(vehicle);
  const u = useUnits();
  const [loaded, setLoaded] = useState<VehicleDetail["vehicle"] | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(VehicleInputSchema),
    values: {
      name: vehicle?.name ?? "",
      licensePlate: vehicle?.licensePlate ?? "",
      status: (vehicle?.vehicleStatus as Values["status"]) ?? "active",
      type: vehicle ? asVehicleType(vehicle.type ?? DEFAULT_VEHICLE_TYPE) : DEFAULT_VEHICLE_TYPE,
      vin: blank(loaded?.vin),
      modelYear: blank(loaded?.modelYear),
      make: blank(loaded?.make),
      model: blank(loaded?.model),
      plateRegion: blank(loaded?.plateRegion),
      fuelType: (loaded?.fuelType as Values["fuelType"]) ?? null,
      color: blank(loaded?.color),
      unitNumber: blank(loaded?.unitNumber),
      // Shown in the company's unit; converted to km on save.
      odometerKm: loaded?.odometerKm == null ? "" : String(Math.round(u.dist(loaded.odometerKm))),
      sortOrder: blank(loaded?.sortOrder)
    }
  });
  const { errors, isSubmitting } = form.formState;
  const type = form.watch("type") ?? DEFAULT_VEHICLE_TYPE;
  const vinValue = normalizeVin(String(form.watch("vin") ?? ""));

  // Editing: load the optional details (the list only carries the basics).
  useEffect(() => {
    if (!open || !vehicle) return;
    let live = true;
    api<VehicleDetail>(`/api/vehicles/${vehicle.id}`)
      .then((d) => live && setLoaded(d.vehicle))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, vehicle]);

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

  const [vinState, setVinState] = useState<{ busy: boolean; info: VinInfo | null; error: string | null }>({ busy: false, info: null, error: null });
  // A new VIN clears the previous look-up result or error.
  useEffect(() => {
    setVinState((s) => (s.info || s.error ? { busy: false, info: null, error: null } : s));
  }, [vinValue]);
  async function lookUpVin() {
    if (!VIN_RE.test(vinValue)) {
      setVinState({ busy: false, info: null, error: vinProblem(vinValue) ?? "Check the VIN." });
      return;
    }
    setVinState({ busy: true, info: null, error: null });
    try {
      const info = await api<VinInfo>(`/api/vin/${vinValue}`);
      // Fill only what the look-up knows, and never overwrite what the user typed.
      const fill = (k: "modelYear" | "make" | "model", v: string | number | null) => {
        if (v != null && !String(form.getValues(k) ?? "").trim()) form.setValue(k, String(v), { shouldDirty: true });
      };
      fill("modelYear", info.modelYear);
      fill("make", info.make);
      fill("model", info.model);
      if (info.fuelType && !form.getValues("fuelType")) form.setValue("fuelType", info.fuelType, { shouldDirty: true });
      setVinState({ busy: false, info, error: null });
    } catch (err) {
      setVinState({ busy: false, info: null, error: errorMessage(err) });
    }
  }

  async function submit(values: Values) {
    try {
      const odo = String(values.odometerKm ?? "").replace(/[,\s]/g, "");
      const body = VehicleInputSchema.parse({ ...values, odometerKm: odo === "" ? null : u.toKm(Number(odo)), fuelType: values.fuelType || null });
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

  const vinInfo = vinState.info;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? "Edit vehicle" : "Add vehicle"} description={editing ? undefined : "It appears on the map as soon as its GPS device reports."} className="max-w-5xl">
        <form method="post" noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-4">
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {/* Left: what every vehicle needs */}
            <div className="grid min-w-0 gap-3.5">
              <div className="grid gap-x-3 gap-y-3 sm:grid-cols-2">
                <Field id="v-name" label="Name" required error={errors.name?.message}>
                  <Input id="v-name" autoFocus placeholder="e.g. Truck 210" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "v-name-error" : undefined} {...form.register("name")} />
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
                        "flex cursor-pointer flex-col items-center gap-0.5 rounded-lg border px-1 py-1 text-center text-[10.5px] leading-tight transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                        type === t ? "border-primary bg-primary-soft text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <input type="radio" value={t} className="sr-only" {...form.register("type")} />
                      <VehiclePicture type={t} state="moving" className="h-7 w-10" />
                      {VEHICLE_TYPE_LABEL[t]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-x-3 gap-y-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                {!editing && freeDevices && freeDevices.length > 0 ? (
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
                ) : editing ? (
                  <Field id="v-status" label="Status">
                    <Select id="v-status" {...form.register("status")}>
                      <option value="active">Active</option>
                      <option value="maintenance">In maintenance</option>
                      <option value="inactive">Inactive</option>
                    </Select>
                  </Field>
                ) : (
                  <span className="hidden sm:block" />
                )}
                <Field id="v-order" label="List order" description="Optional · 1 shows first" error={errors.sortOrder?.message}>
                  <Input id="v-order" inputMode="numeric" placeholder="e.g. 1" aria-invalid={Boolean(errors.sortOrder)} {...form.register("sortOrder")} />
                </Field>
              </div>
            </div>

            {/* Right: optional details */}
            <section aria-labelledby="v-more" className="grid min-w-0 gap-3 rounded-2xl border border-border bg-canvas p-4">
              <h3 id="v-more" className="m-0 flex items-center gap-2 text-sm font-bold text-primary">
                <span className="grid size-6 place-items-center rounded-md bg-primary-soft text-primary">
                  <Tag className="size-3.5" aria-hidden="true" />
                </span>
                More details
                <span className="text-xs font-medium text-muted-foreground">optional</span>
              </h3>
              <Field
                id="v-vin"
                label="VIN"
                error={errors.vin?.message ?? vinState.error}
                description={
                  vinInfo ? (
                    <span className={cn("inline-flex items-center gap-1 font-medium", vinInfo.found ? "text-success" : "text-muted-foreground")}>
                      {vinInfo.found ? <CircleCheck className="size-3.5" aria-hidden="true" /> : <Info className="size-3.5" aria-hidden="true" />}
                      {vinInfo.found ? "Found: filled in year, make and model below." : "Not found in the look-up. Type the details yourself."}
                      {!vinInfo.checkDigitOk && " Check the VIN for a typo."}
                    </span>
                  ) : vinValue ? (
                    <span className={cn("tabular-nums", vinValue.length === 17 ? "text-success" : "")}>
                      {vinValue.length}/17 characters{vinValue.length === 17 ? ". Press Look up to fill year, make and model." : ""}
                    </span>
                  ) : (
                    "17 characters, on the dashboard or driver's door."
                  )
                }
              >
                <div className="flex gap-2">
                  <Input id="v-vin" maxLength={20} autoCapitalize="characters" spellCheck={false} className="font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal" placeholder="e.g. 3AKJHHDR7NSMN1234" aria-invalid={Boolean(errors.vin)} {...form.register("vin")} />
                  <Button type="button" variant="secondary" onClick={lookUpVin} loading={vinState.busy} disabled={vinValue.length === 0}>
                    <Search aria-hidden="true" /> Look up
                  </Button>
                </div>
              </Field>
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
                <Field id="v-year" label="Year" error={errors.modelYear?.message}>
                  <Input id="v-year" inputMode="numeric" maxLength={4} {...form.register("modelYear")} />
                </Field>
                <Field id="v-make" label="Make" error={errors.make?.message}>
                  <Input id="v-make" {...form.register("make")} />
                </Field>
                <Field id="v-model" label="Model" error={errors.model?.message}>
                  <Input id="v-model" {...form.register("model")} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <Field id="v-region" label="Plate state / prov." error={errors.plateRegion?.message}>
                  <Input id="v-region" placeholder="e.g. ON" {...form.register("plateRegion")} />
                </Field>
                <Field id="v-fuel" label="Fuel">
                  <Select id="v-fuel" {...form.register("fuelType", { setValueAs: (v) => v || null })}>
                    <option value="">—</option>
                    {FUEL_TYPES.map((f) => (
                      <option key={f} value={f}>
                        {FUEL_LABEL[f]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="v-color" label="Colour" error={errors.color?.message}>
                  <Input id="v-color" placeholder="e.g. White" {...form.register("color")} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field id="v-odo" label={`Odometer now (${u.distance})`} description="Keeps service reminders accurate" error={errors.odometerKm?.message}>
                  <Input id="v-odo" inputMode="decimal" placeholder={`e.g. 182,400`} {...form.register("odometerKm")} />
                </Field>
                <Field id="v-unit" label="Unit number" description="Your own fleet number" error={errors.unitNumber?.message}>
                  <Input id="v-unit" {...form.register("unitNumber")} />
                </Field>
              </div>
            </section>
          </div>
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
