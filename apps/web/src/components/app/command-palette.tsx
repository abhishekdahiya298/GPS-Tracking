"use client";
import * as D from "@radix-ui/react-dialog";
import { Bell, Building2, Cpu, CornerDownLeft, Hexagon, Loader2, Search, Truck, Users, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { SearchGroup, SearchHit } from "@/lib/search";
import type { NavSection } from "./nav-config";

const GROUPS: Record<SearchGroup | "pages", { label: string; icon?: LucideIcon }> = {
  pages: { label: "Go to" },
  vehicles: { label: "Vehicles", icon: Truck },
  devices: { label: "Devices", icon: Cpu },
  alerts: { label: "Alerts", icon: Bell },
  zones: { label: "Zones", icon: Hexagon },
  team: { label: "Team", icon: Users },
  customers: { label: "Customers", icon: Building2 }
};
const ORDER: (SearchGroup | "pages")[] = ["pages", "vehicles", "devices", "alerts", "zones", "team", "customers"];

type Item = { key: string; group: SearchGroup | "pages"; title: string; subtitle: string | null; href: string };

/** Top-bar trigger + Cmd/Ctrl+K palette. Results come from /api/search (server-side, permission-checked, ≤ 5 per group). */
export function CommandPalette({ nav }: { nav: NavSection[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-64 cursor-pointer items-center gap-2 rounded-md border border-border bg-canvas px-2.5 text-sm text-muted-foreground hover:bg-muted md:flex"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border bg-background px-1.5 font-sans text-[11px]">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-foreground hover:bg-muted md:hidden"
        aria-label="Search"
      >
        <Search className="size-4" aria-hidden="true" />
      </button>
      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-black/30" />
          <D.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-background shadow-pop focus:outline-none" aria-describedby={undefined}>
            <D.Title className="sr-only">Search</D.Title>
            {open && <Palette nav={nav} onDone={() => setOpen(false)} />}
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}

function Palette({ nav, onDone }: { nav: NavSection[]; onDone: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced server search; stale responses are dropped.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?${new URLSearchParams({ q: term })}`, { cache: "no-store", signal: ac.signal });
        if (res.status === 401) return window.location.assign("/login");
        if (!res.ok) throw new Error(String(res.status));
        setHits(((await res.json()) as { hits: SearchHit[] }).hits);
        setFailed(false);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setFailed(true);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const pages = nav
      .flatMap((s) => s.items)
      .filter((i) => !term || i.label.toLowerCase().includes(term))
      .map((i) => ({ key: `p:${i.href}`, group: "pages" as const, title: i.label, subtitle: null, href: i.href }));
    const found = hits.map((h) => ({ key: `${h.group}:${h.id}`, group: h.group, title: h.title, subtitle: h.group === "alerts" && h.subtitle ? new Date(h.subtitle).toLocaleString() : h.subtitle, href: h.href }));
    return [...pages, ...found].sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
  }, [nav, hits, q]);

  useEffect(() => setActive(0), [items.length, q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (it: Item | undefined) => {
    if (!it) return;
    onDone();
    router.push(it.href);
  };

  let lastGroup: string | null = null;
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items[active] ? `cmdk-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Search vehicles, devices, alerts, zones, team"
          placeholder="Search vehicles, devices, alerts, zones, people…"
          className="h-12 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(items[active]);
            }
          }}
        />
        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />}
      </div>
      <div ref={listRef} id="cmdk-list" role="listbox" aria-label="Results" className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
        {items.map((it, i) => {
          const header = it.group !== lastGroup ? GROUPS[it.group].label : null;
          lastGroup = it.group;
          const Icon = GROUPS[it.group].icon;
          return (
            <div key={it.key}>
              {header && (
                <div role="presentation" className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {header}
                </div>
              )}
              <div
                id={`cmdk-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(it)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm", i === active && "bg-primary-soft")}
              >
                {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{it.title}</span>
                  {it.subtitle && <span className="block truncate text-xs text-muted-foreground">{it.subtitle}</span>}
                </span>
                {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </div>
            </div>
          );
        })}
        {q.trim().length >= 2 && !loading && !failed && hits.length === 0 && <p className="m-0 px-3 py-6 text-center text-sm text-muted-foreground">No matches for “{q.trim()}”.</p>}
        {failed && <p className="m-0 px-3 py-6 text-center text-sm text-danger">Search is unavailable right now. Try again.</p>}
      </div>
      <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>↑↓ to move</span>
        <span>Enter to open</span>
        <span>Esc to close</span>
      </div>
    </div>
  );
}
