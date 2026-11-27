"use client";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { PaperworkItem, PaperworkMode } from "@/lib/paperwork";

const NEXT: Record<PaperworkMode, PaperworkMode> = { off: "optional", optional: "required", required: "off" };

/**
 * New load → Paperwork for this load (A41): the company's list as chips; tap to cycle
 * Off → Optional → Required for this load only. Reports only the items that differ.
 */
export function PaperworkPicker({ onChange }: { onChange: (changed: { key: string; mode: PaperworkMode }[]) => void }) {
  const [base, setBase] = useState<PaperworkItem[] | null>(null);
  const [modes, setModes] = useState<Record<string, PaperworkMode>>({});
  useEffect(() => {
    api<{ settings: { items: PaperworkItem[] } }>("/api/organization/paperwork")
      .then((r) => setBase(r.settings.items))
      .catch(() => setBase([]));
  }, []);
  if (!base?.length) return null;
  const mode = (i: PaperworkItem) => modes[i.key] ?? i.mode;
  function tap(i: PaperworkItem) {
    const next = { ...modes, [i.key]: NEXT[mode(i)] };
    setModes(next);
    onChange(base!.filter((b) => (next[b.key] ?? b.mode) !== b.mode).map((b) => ({ key: b.key, mode: next[b.key]! })));
  }
  return (
    <section className="grid gap-2 sm:col-span-2">
      <div className="flex items-center gap-2">
        <FileText className="size-4 text-primary" aria-hidden="true" />
        <b className="text-sm">Paperwork for this load</b>
        <Link href="/settings/organization" className="ml-auto text-xs font-semibold text-primary no-underline hover:underline">
          Defaults in Settings
        </Link>
      </div>
      {(["pickup", "delivery"] as const).map((s) => (
        <div key={s} className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{s}</span>
          {base
            .filter((i) => i.stop === s)
            .map((i) => {
              const m = mode(i);
              return (
                <button
                  key={i.key}
                  type="button"
                  onClick={() => tap(i)}
                  title="Tap: off, optional, required"
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors duration-150",
                    m === "off" ? "border-border bg-background text-muted-foreground line-through decoration-muted-foreground/50" : m === "required" ? "border-danger/40 bg-danger-soft text-danger" : "border-primary/30 bg-primary-soft text-primary"
                  )}
                >
                  {i.label}
                  {m === "required" && <span aria-label="required">*</span>}
                </button>
              );
            })}
        </div>
      ))}
      <p className="m-0 text-[11px] text-muted-foreground">Tap to switch: off, optional, required (*). This load only.</p>
    </section>
  );
}
