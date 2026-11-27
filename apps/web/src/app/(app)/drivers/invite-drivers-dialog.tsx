"use client";
import { Check, Copy, Link2, MessageSquareText, Plus, Send, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { encode } from "uqr";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants, IconButton } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { VehicleOption } from "./driver-form-dialog";

type Row = { name: string; phone: string; vehicleId: string };
type Sent = { name: string; phone: string; url: string; texted: boolean };
const blank = (): Row => ({ name: "", phone: "", vehicleId: "" });

async function copy(v: string) {
  try {
    await navigator.clipboard.writeText(v);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy. Select the text and copy it.");
  }
}

/**
 * Invite drivers (A11). "Text an invite": add drivers by name and phone; each gets a personal
 * link that signs them in to the app (texted when SMS is set up, otherwise shown to copy or send
 * by WhatsApp). "Share link or code": one company link, code and QR for any driver.
 */
export function InviteDriversDialog({
  companyName,
  code,
  vehicles,
  smsReady,
  prefill,
  onClose,
  onDone
}: {
  companyName: string;
  code: string | null;
  vehicles: VehicleOption[];
  smsReady: boolean;
  /** Existing drivers to send a personal link to (from a row or "No app yet"). */
  prefill?: { id: string; name: string; phone: string | null }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"text" | "share">("text");
  const [rows, setRows] = useState<Row[]>(prefill?.length ? [] : [blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[] | null>(null);
  const [consent, setConsent] = useState(false);
  const filled = rows.filter((r) => r.name.trim() && r.phone.trim());
  const count = filled.length + (prefill?.length ?? 0);
  const free = vehicles.filter((v) => !v.driver);

  async function submit() {
    if (smsReady && !consent) {
      setError("Tick that the drivers agreed to receive a text, or use Share link instead.");
      return;
    }
    setBusy(true);
    setError(null);
    const out: Sent[] = [];
    try {
      for (const p of prefill ?? []) {
        const r = await api<{ invite: { url: string }; texted: boolean }>(`/api/drivers/${p.id}/app-invite`, { method: "POST", json: { text: true } });
        out.push({ name: p.name, phone: p.phone ?? "", url: r.invite.url, texted: r.texted });
      }
      for (const r of filled) {
        const created = await api<{ driver: { id: string } }>("/api/drivers", { method: "POST", json: { name: r.name.trim(), phone: r.phone.trim(), vehicleId: r.vehicleId || null } });
        const inv = await api<{ invite: { url: string }; texted: boolean }>(`/api/drivers/${created.driver.id}/app-invite`, { method: "POST", json: { text: true } });
        out.push({ name: r.name.trim(), phone: r.phone.trim(), url: inv.invite.url, texted: inv.texted });
      }
      setSent(out);
      onDone();
    } catch (err) {
      if (out.length) {
        setSent(out);
        onDone();
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const joinLink = code ? (typeof window === "undefined" ? `/signup?code=${encodeURIComponent(code)}` : `${window.location.origin}/signup?code=${encodeURIComponent(code)}`) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Invite drivers"
        description={`Drivers get the RIO GPS app, sign in with their personal link and join ${companyName}.`}
        className="max-w-2xl"
      >
        {sent ? (
          <div className="grid gap-3 px-5 py-4">
            <Alert tone="success">
              {sent.some((s) => s.texted)
                ? `Texted ${sent.filter((s) => s.texted).length} invite${sent.filter((s) => s.texted).length === 1 ? "" : "s"}.`
                : "Invites ready. Send each driver their link (it works once, for 7 days)."}
            </Alert>
            {error && <Alert tone="danger">{error}</Alert>}
            <ul className="m-0 grid list-none gap-2 p-0">
              {sent.map((s) => {
                const msg = `${companyName} invited you to the RIO GPS driver app. Open this link on your phone to sign in: ${s.url}`;
                return (
                  <li key={s.url} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <span className="min-w-0">
                      <b className="block truncate text-sm">
                        {s.name} {s.texted && <span className="ml-1 text-xs font-semibold text-success">· Texted</span>}
                      </b>
                      <span className="block truncate text-xs text-muted-foreground">{s.url}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => void copy(s.url)}>
                        <Copy /> Copy
                      </Button>
                      <a className={buttonVariants({ variant: "secondary", size: "sm" })} href={`https://wa.me/${s.phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                      <a className={buttonVariants({ variant: "secondary", size: "sm" })} href={`sms:${s.phone}?&body=${encodeURIComponent(msg)}`}>
                        <MessageSquareText /> Text
                      </a>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-end">
              <Button onClick={onClose}>
                <Check /> Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 px-5 py-4">
              <div role="tablist" aria-label="How to invite" className="inline-flex w-fit gap-1 rounded-xl bg-muted p-1">
                {(
                  [
                    ["text", smsReady ? "Text an invite" : "Invite by name"],
                    ["share", "Share link or code"]
                  ] as const
                ).map(([k, label]) =>
                  k === "share" && !code ? null : (
                    <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 cursor-pointer rounded-lg border-0 px-3 text-[13px] font-semibold", tab === k ? "bg-background text-primary shadow-card" : "bg-transparent text-muted-foreground")}>
                      {label}
                    </button>
                  )
                )}
              </div>

              {tab === "text" ? (
                <div className="grid gap-2">
                  {prefill?.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        <b>{p.name}</b> <span className="text-muted-foreground">{p.phone ?? "no phone"}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">Personal link</span>
                    </div>
                  ))}
                  {rows.length > 0 && (
                    <div className="hidden grid-cols-[1fr_1fr_1fr_32px] gap-2 text-[13px] font-medium sm:grid">
                      <span>Driver name</span>
                      <span>Mobile number</span>
                      <span>Truck (optional)</span>
                      <span />
                    </div>
                  )}
                  {rows.map((r, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_32px] sm:items-center">
                      <Input aria-label="Driver name" placeholder="Driver name" value={r.name} maxLength={120} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                      <PhoneInput aria-label="Mobile number" value={r.phone} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, phone: v } : x)))} />
                      <Select aria-label="Truck" value={r.vehicleId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, vehicleId: e.target.value } : x)))}>
                        <option value="">No truck yet</option>
                        {free.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </Select>
                      <IconButton label="Remove row" size="icon-sm" variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        <X aria-hidden="true" />
                      </IconButton>
                    </div>
                  ))}
                  <button type="button" onClick={() => setRows([...rows, blank()])} className="inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-sm font-semibold text-primary">
                    <Plus className="size-4" aria-hidden="true" /> Add {rows.length || prefill?.length ? "another" : "a"} driver
                  </button>
                  {smsReady && count > 0 && (
                    <label className="mt-1 flex items-start gap-2 text-sm">
                      <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                      <span>
                        {count === 1 ? "This driver" : "These drivers"} agreed to receive a text from us with their app link.
                        <span className="block text-xs text-muted-foreground">One text per driver. Msg &amp; data rates may apply. They can reply STOP to opt out or HELP for help.</span>
                      </span>
                    </label>
                  )}
                  {!smsReady && <p className="m-0 text-xs text-muted-foreground">Text messages aren&apos;t set up yet, so you&apos;ll get each driver&apos;s link to send by WhatsApp or your own phone.</p>}
                </div>
              ) : (
                code &&
                joinLink && (
                  <div className="grid gap-4 rounded-xl border border-border bg-muted/40 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="grid content-start gap-3">
                      <b className="text-sm">Share with any driver</b>
                      <div className="flex gap-2">
                        <span className="relative min-w-0 flex-1">
                          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                          <Input readOnly value={joinLink} aria-label="Join link" className="pl-9" onFocus={(e) => e.currentTarget.select()} />
                        </span>
                        <Button variant="secondary" onClick={() => void copy(joinLink)}>
                          <Copy /> Copy
                        </Button>
                      </div>
                      <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
                        Company code <b className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-base tracking-wider text-[#0a2463] dark:text-foreground">{code}</b>
                      </p>
                      <p className="m-0 text-xs text-muted-foreground">Drivers who join with the code confirm their phone, then appear on your Drivers list.</p>
                    </div>
                    <figure className="m-0 grid justify-items-center gap-1">
                      <Qr value={joinLink} />
                      <figcaption className="text-xs text-muted-foreground">Scan to join</figcaption>
                    </figure>
                  </div>
                )
              )}

              <p className="m-0 flex items-start gap-2 rounded-xl border border-success/30 bg-success-soft px-3 py-2 text-xs text-success">
                <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
                Drivers agree to share location all the time while signed in. The app always shows that it&apos;s sharing, and they can see what was shared.
              </p>
              {error && <Alert tone="danger">{error}</Alert>}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              {tab === "text" && (
                <Button onClick={() => void submit()} loading={busy} disabled={count === 0}>
                  <Send /> {smsReady ? `Text ${count || ""} invite${count === 1 ? "" : "s"}` : `Create ${count || ""} invite${count === 1 ? "" : "s"}`}
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Qr({ value }: { value: string }) {
  const path = useMemo(() => {
    const { data, size } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
    return { d, size };
  }, [value]);
  return (
    <svg role="img" aria-label="QR code to join" viewBox={`0 0 ${path.size} ${path.size}`} width={132} height={132} shapeRendering="crispEdges" className="rounded-lg border border-border bg-white">
      <path d={path.d} fill="#0a2463" />
    </svg>
  );
}
