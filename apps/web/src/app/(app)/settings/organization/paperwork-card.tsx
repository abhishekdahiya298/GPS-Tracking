"use client";
import { Camera, FileText, Mail, Plus, ScanLine, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { PaperworkItem, PaperworkMode, PaperworkSettings } from "@/lib/paperwork";

const MODES: { v: PaperworkMode; label: string; on: string }[] = [
  { v: "off", label: "Off", on: "text-muted-foreground" },
  { v: "optional", label: "Optional", on: "text-primary" },
  { v: "required", label: "Required", on: "text-danger" }
];
const WHEN: { v: PaperworkSettings["sendWhen"]; label: string }[] = [
  { v: "delivered", label: "When delivered" },
  { v: "complete", label: "When all required paperwork is in" },
  { v: "manual", label: "Only when I click Send" }
];

/** Settings → Load paperwork (A39): what drivers send at pickup and delivery, and who gets the packet. */
export function PaperworkCard({ initial }: { initial: PaperworkSettings }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  const setItem = (key: string, patch: Partial<PaperworkItem>) => setV({ ...v, items: v.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  function addItem(stop: PaperworkItem["stop"]) {
    const n = v.items.filter((i) => i.key.startsWith(`${stop}_custom`)).length + 1;
    setV({ ...v, items: [...v.items, { key: `${stop}_custom${n}`, stop, label: "New item", kind: "doc", mode: "optional" }] });
  }
  function addEmail() {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return toast.error("Enter an email like billing@company.com");
    if (!v.recipients.includes(e)) setV({ ...v, recipients: [...v.recipients, e] });
    setEmail("");
  }
  async function save() {
    setSaving(true);
    try {
      await api("/api/organization/paperwork", { method: "PUT", json: v });
      toast.success("Load paperwork saved");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const stops: { stop: PaperworkItem["stop"]; title: string; hint: string; dot: string }[] = [
    { stop: "pickup", title: "At pickup", hint: "Asked when the driver arrives at pickup", dot: "bg-success" },
    { stop: "delivery", title: "At delivery", hint: "Asked when the driver arrives at delivery", dot: "bg-danger" }
  ];

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <FileText className="size-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle>Load paperwork</CardTitle>
            <CardDescription>What your drivers send at pickup and delivery, and who gets the load packet (one PDF with everything).</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          {stops.map((s) => (
            <section key={s.stop} className="overflow-hidden rounded-xl border border-border">
              <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                <i className={cn("size-2.5 rounded-full", s.dot)} aria-hidden="true" />
                <b className="text-sm">{s.title}</b>
                <span className="text-xs text-muted-foreground">· {s.hint}</span>
              </header>
              <ul className="m-0 list-none divide-y divide-border p-0">
                {v.items
                  .filter((i) => i.stop === s.stop)
                  .map((i) => (
                    <li key={i.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <span className="grid min-w-0 gap-1">
                        {i.key.includes("_custom") ? (
                          <Input aria-label="Item name" value={i.label} maxLength={60} onChange={(e) => setItem(i.key, { label: e.target.value })} className="h-8" />
                        ) : (
                          <b className="truncate text-sm">{i.label}</b>
                        )}
                        <button
                          type="button"
                          onClick={() => setItem(i.key, { kind: i.kind === "doc" ? "photo" : "doc" })}
                          className="inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs text-muted-foreground hover:text-primary"
                          title="Tap to switch"
                        >
                          {i.kind === "doc" ? <ScanLine className="size-3.5" aria-hidden="true" /> : <Camera className="size-3.5" aria-hidden="true" />}
                          {i.kind === "doc" ? "Scanner first" : "Camera first"}
                        </button>
                      </span>
                      <span role="radiogroup" aria-label={`${i.label}: off, optional or required`} className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
                        {MODES.map((m) => {
                          const on = i.mode === m.v;
                          return (
                            <button key={m.v} type="button" role="radio" aria-checked={on} onClick={() => setItem(i.key, { mode: m.v })} className={cn("cursor-pointer rounded-md border-0 px-2.5 py-1 text-xs font-bold transition-[background,box-shadow] duration-150", on ? cn("bg-background shadow-card", m.on) : "bg-transparent text-muted-foreground hover:text-foreground")}>
                              {m.label}
                            </button>
                          );
                        })}
                      </span>
                      {i.key.includes("_custom") ? (
                        <button type="button" aria-label={`Remove ${i.label}`} onClick={() => setV({ ...v, items: v.items.filter((x) => x.key !== i.key) })} className="grid size-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-muted-foreground hover:bg-danger-soft hover:text-danger">
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      ) : (
                        <span className="hidden sm:block sm:w-8" />
                      )}
                    </li>
                  ))}
              </ul>
              {v.items.length < 20 && (
                <button type="button" onClick={() => addItem(s.stop)} className="flex w-full cursor-pointer items-center gap-1.5 border-0 border-t border-border bg-transparent px-3 py-2 text-sm font-semibold text-primary hover:bg-muted/50">
                  <Plus className="size-4" aria-hidden="true" /> Add your own item
                </button>
              )}
            </section>
          ))}
          <p className="m-0 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>
              <b>Required never blocks the load.</b> Pickup and delivery still happen by location. A missing required item flags the load and reminds the driver (after 15 minutes, then every hour for 4 hours).
            </span>
          </p>
        </div>
        <div className="grid content-start gap-4">
          <section className="grid gap-2 rounded-xl border border-border p-3">
            <b className="text-sm">How drivers capture</b>
            <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
              <ScanLine className="size-4 text-primary" aria-hidden="true" /> Documents open the scanner (finds the edges, crops, sharpens).
            </p>
            <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
              <Camera className="size-4 text-primary" aria-hidden="true" /> Photos open the camera.
            </p>
            <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
              <Upload className="size-4 text-primary" aria-hidden="true" /> They can always switch to the camera or upload a file. Time and place are recorded; it works offline.
            </p>
          </section>
          <section className="grid gap-3 rounded-xl border border-border p-3">
            <b className="flex items-center gap-2 text-sm">
              <Mail className="size-4 text-primary" aria-hidden="true" /> Load packet email
            </b>
            <div role="radiogroup" aria-label="Send automatically" className="flex flex-wrap gap-1.5">
              {WHEN.map((w) => (
                <button key={w.v} type="button" role="radio" aria-checked={v.sendWhen === w.v} onClick={() => setV({ ...v, sendWhen: w.v })} className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors", v.sendWhen === w.v ? "border-primary bg-primary-soft text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground")}>
                  {w.label}
                </button>
              ))}
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Person who created the load
                <span className="block text-xs text-muted-foreground">Changes per load</span>
              </span>
              <Switch checked={v.toCreator} onCheckedChange={(c) => setV({ ...v, toCreator: c })} label="Send to the person who created the load" />
            </label>
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {v.recipients.map((e) => (
                <li key={e} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{e}</span>
                  <button type="button" aria-label={`Remove ${e}`} onClick={() => setV({ ...v, recipients: v.recipients.filter((x) => x !== e) })} className="grid size-6 cursor-pointer place-items-center rounded border-0 bg-transparent text-muted-foreground hover:text-danger">
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {v.recipients.length < 10 && (
              <div className="flex gap-2">
                <Input type="email" aria-label="Add an email" placeholder="billing@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())} />
                <Button variant="secondary" onClick={addEmail}>
                  Add
                </Button>
              </div>
            )}
          </section>
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {dirty && (
          <Button variant="secondary" onClick={() => setV(initial)}>
            Cancel
          </Button>
        )}
        <Button onClick={save} loading={saving} disabled={!dirty}>
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}
