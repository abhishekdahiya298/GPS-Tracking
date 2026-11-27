"use client";
import { Bell, Camera, Check, Download, Eye, FileText, Mail, Send, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RelativeTime } from "@/components/app/local-time";
import { useTime } from "@/components/app/time-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { LoadDocumentDto, LoadPaperworkDto } from "@/lib/paperwork";

/**
 * Load details → Paperwork (A40): what was sent at pickup and delivery, what's missing, the team's
 * upload, and the load packet (one PDF) to preview or email.
 */
export function PaperworkPanel({ loadId, canWrite, reference }: { loadId: string; canWrite: boolean; reference: string }) {
  const [pw, setPw] = useState<LoadPaperworkDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string>("");
  const t = useTime();

  const load = useCallback(() => {
    api<LoadPaperworkDto>(`/api/loads/${loadId}/paperwork`)
      .then((r) => (setPw(r), setError(null)))
      .catch((e) => setError(errorMessage(e)));
  }, [loadId]);
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function upload(file: File, itemKey: string) {
    setBusy(`up:${itemKey}`);
    try {
      const fd = new FormData();
      fd.set("itemKey", itemKey);
      fd.set("file", file);
      const res = await fetch(`/api/loads/${loadId}/documents`, { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Upload failed");
      setPw(body);
      toast.success("Added to the load");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function remove(d: LoadDocumentDto) {
    setBusy(`rm:${d.id}`);
    try {
      setPw(await api<LoadPaperworkDto>(`/api/loads/${loadId}/documents/${d.id}`, { method: "DELETE" }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function sendPacket() {
    setBusy("send");
    try {
      const r = await api<{ sentTo: string[]; paperwork: LoadPaperworkDto }>(`/api/loads/${loadId}/packet`, { method: "POST", json: {} });
      setPw(r.paperwork);
      toast.success(`Packet sent to ${r.sentTo.join(", ")}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const docUrl = (d: LoadDocumentDto, download = false) => `/api/loads/${loadId}/documents/${d.id}${download ? "?download=1" : ""}`;
  const stops = (["pickup", "delivery"] as const).map((s) => ({ s, items: pw?.items.filter((i) => i.stop === s) ?? [] })).filter((x) => x.items.length);

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
              <FileText className="size-4" aria-hidden="true" />
            </span>
            Paperwork
          </CardTitle>
          {pw && (
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", pw.missing ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground")}>
              {pw.missing ? `${pw.missing} missing` : `${pw.requiredDone} of ${pw.requiredCount} required in`}
            </span>
          )}
          {canWrite && pw && (
            <span className="ml-auto flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => (setTarget(pw.items.find((i) => i.missing)?.key ?? pw.items[0]?.key ?? "other"), fileRef.current?.click())} loading={busy?.startsWith("up:")}>
                <Upload aria-hidden="true" /> Upload
              </Button>
              <Button asChild size="sm" variant="secondary">
                <a href={`/api/loads/${loadId}/packet?download=1`}>
                  <Download aria-hidden="true" /> Download all
                </a>
              </Button>
            </span>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/heic,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f, target);
            }}
          />
          {error && <p className="m-0 text-sm text-danger">{error}</p>}
          {!pw && !error && <Skeleton className="h-40" />}
          {pw && pw.items.length === 0 && <p className="m-0 text-sm text-muted-foreground">No paperwork is asked for this load. Change the list in Settings → Load paperwork.</p>}
          {stops.map(({ s, items }) => (
            <section key={s} className="grid gap-2">
              <h3 className="m-0 flex items-center gap-2 text-sm font-bold">
                <i className={cn("size-2.5 rounded-full", s === "pickup" ? "bg-success" : "bg-danger")} aria-hidden="true" />
                {s === "pickup" ? "Pickup" : "Delivery"}
              </h3>
              <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((i) => (
                  <li key={i.key} className="grid min-w-0 content-start gap-1.5">
                    {i.docs.length ? (
                      <div className="grid gap-1.5">
                        {i.docs.map((d) => (
                          <div key={d.id} className="group relative overflow-hidden rounded-xl border border-border bg-background transition-shadow hover:shadow-card">
                            <a href={docUrl(d)} target="_blank" rel="noreferrer" className="block" aria-label={`Open ${i.label}`}>
                              {d.contentType.startsWith("image/") && d.contentType !== "image/heic" ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={docUrl(d)} alt={i.label} loading="lazy" className="h-24 w-full object-cover" />
                              ) : (
                                <span className="grid h-24 place-items-center bg-muted/50 text-xs font-semibold text-muted-foreground">
                                  <FileText className="size-6" aria-hidden="true" />
                                  {d.contentType === "application/pdf" ? "PDF" : "Photo"}
                                </span>
                              )}
                            </a>
                            {canWrite && (
                              <button type="button" onClick={() => void remove(d)} aria-label={`Remove this ${i.label}`} className="absolute right-1 top-1 hidden size-7 cursor-pointer place-items-center rounded-md border-0 bg-background/90 text-danger shadow-card group-hover:grid">
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </button>
                            )}
                            <span className="flex items-center gap-1 px-2 py-1 text-[11px] text-success">
                              <Check className="size-3" aria-hidden="true" />
                              {d.method === "scan" ? "Scanned" : d.method === "camera" ? <Camera className="size-3" aria-hidden="true" /> : null} {t.time(d.at)}
                              {d.by === "team" && <span className="text-muted-foreground"> · team</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => (setTarget(i.key), fileRef.current?.click())}
                        className={cn("grid h-24 place-items-center rounded-xl border-2 border-dashed text-xs font-semibold transition-colors", i.missing ? "border-danger/50 bg-danger-soft text-danger" : "border-border bg-muted/30 text-muted-foreground", canWrite && "cursor-pointer hover:border-primary/60")}
                      >
                        {i.missing ? "Missing" : i.mode === "required" ? (i.due ? "Missing" : "Required") : "Optional"}
                      </button>
                    )}
                    <b className="truncate text-[12.5px]">{i.label}</b>
                    {i.missing && <span className="text-[11px] font-semibold text-danger">Required</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {pw && pw.missing > 0 && (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>
                <b>{pw.items.filter((i) => i.missing).map((i) => i.label).join(", ")} missing.</b> The driver gets a reminder in the app. You can also upload it yourself if it was emailed to you.
              </span>
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary">
              <Mail className="size-4" aria-hidden="true" />
            </span>
            Load packet
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-2.5">
            <span className="grid size-10 place-items-center rounded-lg bg-danger-soft text-danger">
              <FileText className="size-5" aria-hidden="true" />
            </span>
            <span className="grid min-w-0 flex-1">
              <b className="truncate">{reference.replace(/[^\w.-]+/g, "-")}-packet.pdf</b>
              <span className="text-xs text-muted-foreground">Details, timeline and every document</span>
            </span>
            <Button asChild size="sm" variant="secondary">
              <a href={`/api/loads/${loadId}/packet`} target="_blank" rel="noreferrer">
                <Eye aria-hidden="true" /> Preview
              </a>
            </Button>
          </div>
          {pw && (
            <p className="m-0 text-muted-foreground">
              {pw.packet.sendWhen === "manual" ? "Sent only when you click Send." : pw.packet.sendWhen === "complete" ? "Sends when all required paperwork is in" : "Sends when the load is delivered"}
              {pw.packet.recipients.length ? (
                <>
                  {" "}
                  to <b className="text-foreground">{pw.packet.recipients.join(", ")}</b>.
                </>
              ) : (
                "."
              )}
            </p>
          )}
          {pw?.packet.sentAt ? (
            <p className="m-0 flex items-center gap-1.5 text-success">
              <Check className="size-4" aria-hidden="true" /> Sent <RelativeTime iso={pw.packet.sentAt} />
            </p>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">Not sent yet.</p>
          )}
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={sendPacket} loading={busy === "send"}>
                <Send aria-hidden="true" /> {pw?.packet.sentAt ? "Send again" : "Send now"}
              </Button>
              {pw && pw.missing > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Bell className="size-3.5" aria-hidden="true" /> Driver reminded automatically
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
