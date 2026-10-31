"use client";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";

export type StatusAction = "suspend" | "reactivate" | "archive" | "restore";

const COPY: Record<StatusAction, { title: string; status: "active" | "suspended" | "archived"; confirm: string; effects: string[]; reason: boolean; danger: boolean; done: string }> = {
  suspend: {
    title: "Suspend customer",
    status: "suspended",
    confirm: "Suspend",
    reason: true,
    danger: false,
    done: "Customer suspended",
    effects: [
      "Their users can't sign in (web and phone app) until you reactivate.",
      "No alerts, emails, phone notifications or scheduled reports go out.",
      "Driver and shipper links and shared vehicle links stop working.",
      "Trackers keep recording, so no history is lost."
    ]
  },
  reactivate: {
    title: "Reactivate customer",
    status: "active",
    confirm: "Reactivate",
    reason: false,
    danger: false,
    done: "Customer reactivated",
    effects: ["Their users can sign in again and alerts, emails and links work as before."]
  },
  archive: {
    title: "Archive customer",
    status: "archived",
    confirm: "Archive customer",
    reason: true,
    danger: true,
    done: "Customer archived",
    effects: [
      "This is a soft delete: nothing is erased and you can restore it at any time.",
      "Their users can't sign in and no alerts, emails or reports go out.",
      "Positions from their trackers are no longer stored while archived.",
      "Their trackers stay registered to them; the customer is hidden from the Current list."
    ]
  },
  restore: {
    title: "Restore customer",
    status: "active",
    confirm: "Restore",
    reason: false,
    danger: false,
    done: "Customer restored",
    effects: ["The customer comes back exactly as it was: users can sign in and trackers are stored again.", "Positions sent while it was archived were not kept."]
  }
};

/** Suspend / reactivate / archive (soft delete) / restore, with a reason and, for archive, typing the name. */
export function StatusDialog({ customer, action, onOpenChange, onDone }: { customer: { id: string; name: string }; action: StatusAction; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const c = COPY[action];
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOk = action !== "archive" || typed.trim().toLowerCase() === customer.name.trim().toLowerCase();
  const reasonOk = !c.reason || reason.trim().length >= 3;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!nameOk || !reasonOk) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/customers/${customer.id}/status`, { method: "POST", json: { status: c.status, ...(c.reason ? { reason: reason.trim() } : {}) } });
      toast.success(c.done);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent title={`${c.title}: ${customer.name}`} className="max-w-lg" role={c.danger ? "alertdialog" : undefined}>
        <form onSubmit={submit} className="grid gap-4">
          <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
            {c.effects.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {c.reason && (
            <Field id="status-reason" label="Reason" description="Seen by platform admins only; saved in the activity log." required>
              <Textarea id="status-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={action === "suspend" ? "e.g. Invoice 1042 unpaid since Oct 1" : "e.g. Customer cancelled their subscription"} autoFocus />
            </Field>
          )}
          {action === "archive" && (
            <Field id="status-confirm" label={<>Type <strong>{customer.name}</strong> to confirm</>} required>
              <Input id="status-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </Field>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={c.danger ? "danger" : "primary"} loading={busy} disabled={!nameOk || !reasonOk}>
              {c.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
