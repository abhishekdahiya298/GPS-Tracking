"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { DeviceRow } from "@/lib/fleet-list";
import { DevicePatchSchema } from "@/lib/schemas/vehicle";

export function RenameDialog({ device, onClose, onSaved }: { device: DeviceRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(device?.name ?? ""), [device]);
  return (
    <Dialog
      open={device !== null}
      onOpenChange={(o) => {
        if (o) return;
        setError(null);
        onClose();
      }}
    >
      <DialogContent title="Rename device" description="A name your team recognises, e.g. “Truck 7 tracker”. Leave empty to use the model name.">
        <form
          method="post"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = DevicePatchSchema.safeParse({ name: name.trim() || null });
            if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid name");
            setBusy(true);
            try {
              await api(`/api/devices/${device!.id}`, { method: "PATCH", json: parsed.data });
              toast.success("Device renamed.");
              onClose();
              onSaved();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id="d-name" label="Name" error={error}>
            <Input
              id="d-name"
              value={name}
              placeholder={device?.model ?? "Tracker name"}
              maxLength={80}
              autoFocus
              aria-invalid={Boolean(error)}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
