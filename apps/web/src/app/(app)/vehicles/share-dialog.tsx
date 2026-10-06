"use client";
/**
 * Share one vehicle's live position with someone outside the organization through a
 * temporary public link. The link is shown once (the server keeps only a hash of it).
 */
import { Check, Copy, Link2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useTime } from "@/components/app/time-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { ShareLinkDto } from "@/lib/share-links";

const DURATIONS: [number, string][] = [
  [1, "1 hour"],
  [8, "8 hours"],
  [24, "24 hours"],
  [72, "3 days"],
  [168, "7 days"],
  [720, "30 days"]
];

export function ShareDialog({ vehicle, onClose }: { vehicle: { id: string; name: string; hasDevice: boolean }; onClose: () => void }) {
  const time = useTime();
  const [links, setLinks] = useState<ShareLinkDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ShareLinkDto | null>(null);

  const load = useCallback(async () => {
    try {
      setLinks((await api<{ links: ShareLinkDto[] }>(`/api/share-links?vehicleId=${vehicle.id}`)).links);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [vehicle.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const label = String(new FormData(e.currentTarget).get("label") ?? "").trim() || null;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; expiresAt: string }>("/api/share-links", { method: "POST", json: { vehicleId: vehicle.id, hours, label } });
      // The secret goes in the fragment (#…): browsers never send that part to any server.
      setCreated({ url: `${window.location.origin}/share#${r.token}`, expiresAt: r.expiresAt });
      setCopied(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy automatically. Select the link and copy it.");
    }
  }

  const active = (links ?? []).filter((l) => l.active);
  const when = (iso: string) => `${time.dateTime(iso)} ${time.abbr(iso)}`;

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent title={`Share ${vehicle.name}`} description="Anyone with the link can see where this vehicle is right now, without signing in, until the link expires or you turn it off.">
          {created ? (
            <div className="grid gap-4">
              <Alert tone="warning">
                <span className="font-medium">Copy the link now.</span> For security it can&apos;t be shown again. If you lose it, make a new one.
              </Alert>
              <Field id="sh-url" label="Share link" description={`Works until ${when(created.expiresAt)}.`}>
                <div className="flex gap-2">
                  <Input id="sh-url" readOnly value={created.url} className="min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" onClick={copy}>
                    {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </Field>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setCreated(null)}>
                  Make another
                </Button>
                <Button onClick={onClose}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="grid gap-5">
              {!vehicle.hasDevice && <Alert tone="warning">This vehicle has no GPS device assigned, so the link will show no position until one is.</Alert>}
              <form method="post" onSubmit={create} className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="sh-hours" label="Link works for" required>
                    <Select id="sh-hours" value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
                      {DURATIONS.map(([h, label]) => (
                        <option key={h} value={h}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="sh-label" label="For (optional)" description="Only you see this note.">
                    <Input id="sh-label" name="label" maxLength={80} placeholder="e.g. Acme receiving dock" />
                  </Field>
                </div>
                <p className="m-0 flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  The page shows the vehicle&apos;s name, current position and speed. It never shows trip history, other vehicles or your company details.
                </p>
                {error && <Alert tone="danger">{error}</Alert>}
                <div>
                  <Button type="submit" loading={busy}>
                    <Link2 /> Create link
                  </Button>
                </div>
              </form>

              <section aria-label="Active links" className="grid gap-2">
                <h3 className="m-0 text-sm font-medium">Active links for this vehicle</h3>
                {loadError ? (
                  <Alert tone="danger">{loadError}</Alert>
                ) : links === null ? (
                  <p className="m-0 text-sm text-muted-foreground">Loading…</p>
                ) : active.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">None. Nobody outside your organization can see this vehicle.</p>
                ) : (
                  <ul className="m-0 max-h-48 list-none divide-y divide-border overflow-y-auto rounded-lg border border-border p-0">
                    {active.map((l) => (
                      <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="truncate font-medium">{l.label ?? "Share link"}</div>
                          <div className="text-xs text-muted-foreground">
                            Expires {when(l.expiresAt)} · {l.lastViewedAt ? `last viewed ${when(l.lastViewedAt)}` : "not opened yet"}
                            {l.createdByName ? ` · by ${l.createdByName}` : ""}
                          </div>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => setRevoking(l)}>
                          Turn off
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <DialogFooter>
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Turn off this link?"
        description="It stops working immediately for everyone who has it. This can't be undone; you can always make a new link."
        confirmLabel="Turn off link"
        destructive
        onConfirm={async () => {
          try {
            await api(`/api/share-links/${revoking!.id}`, { method: "DELETE" });
            toast.success("Link turned off.");
            await load();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      />
    </>
  );
}
