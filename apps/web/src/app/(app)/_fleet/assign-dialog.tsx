"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { DevicePicker, VehiclePicker } from "./pickers";

/** Assign a device to a vehicle, starting from either side. Moving a device ends its previous assignment. */
export function AssignDialog({
  open,
  onOpenChange,
  mode,
  fixedId,
  title,
  onDone
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** "device": pick a device for vehicle fixedId; "vehicle": pick a vehicle for device fixedId. */
  mode: "device" | "vehicle";
  fixedId: string;
  title: string;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked(null);
        onOpenChange(o);
      }}
    >
      <DialogContent title={title} description="The position history stays with the vehicle it was recorded on.">
        {mode === "device" ? <DevicePicker value={picked} onChange={setPicked} /> : <VehiclePicker value={picked} onChange={setPicked} />}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!picked}
            loading={busy}
            onClick={async () => {
              if (!picked) return;
              setBusy(true);
              try {
                const deviceId = mode === "device" ? picked : fixedId;
                const vehicleId = mode === "device" ? fixedId : picked;
                await api(`/api/devices/${deviceId}/assignment`, { method: "PUT", json: { vehicleId } });
                toast.success("Device assigned.");
                setPicked(null);
                onOpenChange(false);
                onDone();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
