"use client";
import { Send, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";

/** The company can ask again after this long (the server enforces it too). */
export const ASK_EVERY_MS = 15 * 60_000;

export function canAskAgainAt(askedAt: string | null): number | null {
  if (!askedAt) return null;
  const next = Date.parse(askedAt) + ASK_EVERY_MS;
  return next > Date.now() ? next : null;
}

/** A10B: push "turn on location" to the driver's phone, with an optional message. */
export function AskLocationDialog({ driverId, driverName, since, onClose, onSent }: { driverId: string; driverName: string; since: string | null; onClose: () => void; onSent: () => void }) {
  const first = driverName.split(/\s+/)[0] ?? driverName;
  const [message, setMessage] = useState(since ? `Can't see you since ${new Date(since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Please turn location back on.` : "Please turn your location back on.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/drivers/${driverId}/ask-location`, { method: "POST", json: { message } });
      toast.success(`Request sent to ${first}`);
      onSent();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Ask ${first} to turn on location`} description="They get a notification on their phone with a Turn on button." className="max-w-lg">
        <div className="grid gap-3 px-5 py-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Message (optional)
            <Textarea value={message} maxLength={240} rows={3} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <p className="m-0 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /> {first} sees who asked. You can ask once every 15 minutes.
          </p>
          {error && <Alert tone="danger" title={error} />}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void send()}>
            <Send /> Send request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
