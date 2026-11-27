"use client";
import { checkPhone } from "@rio-gps/core/phone";
import { BellRing, CheckCircle2, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { DriverLookup } from "@/lib/driver-loads";

/**
 * Under the driver's mobile (A43): once the number is complete, says whether the driver is on the
 * RIO GPS app (the load goes straight there, no text) and fills in the name for drivers you
 * worked with. Others show as "First L." only.
 */
export function DriverLookupNote({ phone, onName }: { phone: string; onName: (name: string) => void }) {
  const [r, setR] = useState<DriverLookup | null>(null);
  const ok = checkPhone(phone).ok;
  useEffect(() => {
    if (!ok) return setR(null);
    let live = true;
    const t = setTimeout(() => {
      api<DriverLookup>(`/api/drivers/lookup?phone=${encodeURIComponent(phone)}`)
        .then((x) => {
          if (!live) return;
          setR(x);
          if (x.known && x.name) onName(x.name);
        })
        .catch(() => live && setR(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, ok]);
  if (!r) return null;
  return (
    <p className={cn("m-0 flex animate-in items-start gap-2 rounded-lg px-3 py-2 text-xs", r.onRio ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
      {r.onRio ? <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden="true" /> : <MessageSquare className="mt-px size-4 shrink-0" aria-hidden="true" />}
      <span>
        {r.onRio ? (
          <>
            <b>On the RIO GPS app{r.name ? ` · ${r.name}` : ""}.</b>
            {r.known && r.loadsWithYou > 0 ? ` ${r.loadsWithYou} load${r.loadsWithYou > 1 ? "s" : ""} with you.` : ""} The load goes straight to the app <BellRing className="inline size-3" aria-hidden="true" />, no text needed.
          </>
        ) : (
          <>
            <b>Not on RIO GPS yet.</b> After you create the load, send them the app link (text or WhatsApp). The load waits in the app.
          </>
        )}
      </span>
    </p>
  );
}
