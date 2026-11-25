"use client";
import { Cpu, MapPin, MapPinOff, Phone, Send, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { SearchInput } from "@/components/app/search-input";
import { RelativeTime } from "@/components/app/local-time";
import { useUnits } from "@/components/app/units-context";
import { Skeleton } from "@/components/ui/skeleton";
import type { MapDriverDto } from "@/lib/driver-app";
import type { CurrentDeviceLocation } from "@/lib/locations";
import { cn } from "@/lib/cn";
import { APP_STATE, AppStateChip, Battery } from "../drivers/driver-app-bits";
import { DriverAvatar } from "../drivers/drivers-view";

type DFilter = "all" | "driving" | "stopped" | "location_off" | "no_app";
const MOVING_KPH = 5;

/**
 * Live map → Drivers (A03): every active driver, always on (no duty switch), with or without a
 * load. Location comes from the truck's tracker when it has one, otherwise from the phone.
 */
export function DriversMapPanel({ map, devices, version, onFocus }: { map: MlMap | null; devices: MutableRefObject<Map<string, CurrentDeviceLocation>>; version: number; onFocus: (deviceId: string) => void }) {
  const u = useUnits();
  const [drivers, setDrivers] = useState<MapDriverDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/drivers/map", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load drivers"))))
        .then((j: { drivers: MapDriverDto[] }) => live && (setDrivers(j.drivers), setError(null)))
        .catch((e: Error) => live && setError(e.message));
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const rows = useMemo(() => {
    void version;
    return (drivers ?? []).map((d) => {
      const dev = d.deviceId ? devices.current.get(d.deviceId) : undefined;
      const loc = dev?.location ?? null;
      const speed = loc?.speedKph ?? 0;
      const fresh = loc ? Date.now() - Date.parse(loc.recordedAt) < 10 * 60_000 : false;
      const driving = fresh && speed >= MOVING_KPH;
      return { d, loc, driving, speed };
    });
  }, [drivers, devices, version]);

  const counts = {
    all: rows.length,
    driving: rows.filter((r) => r.driving).length,
    stopped: rows.filter((r) => !r.driving && r.loc).length,
    location_off: rows.filter((r) => r.d.app.state === "location_off").length,
    no_app: rows.filter((r) => r.d.app.state === "no_app" || r.d.app.state === "signed_out").length
  };
  const sharing = rows.filter((r) => r.d.app.state === "sharing").length;
  const q = search.trim().toLowerCase();
  const shown = rows
    .filter((r) => (filter === "all" ? true : filter === "driving" ? r.driving : filter === "stopped" ? !r.driving && !!r.loc : filter === "location_off" ? r.d.app.state === "location_off" : r.d.app.state === "no_app" || r.d.app.state === "signed_out"))
    .filter((r) => !q || r.d.name.toLowerCase().includes(q) || (r.d.phone ?? "").includes(q) || (r.d.vehicle?.name ?? "").toLowerCase().includes(q))
    .sort((a, b) => Number(b.driving) - Number(a.driving) || Number(!!b.loc) - Number(!!a.loc) || a.d.name.localeCompare(b.d.name));

  // Driver avatars on the map, over the vehicle icons.
  const markers = useRef(new Map<string, Marker>());
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    void import("maplibre-gl").then(({ default: ml }) => {
      if (cancelled) return;
      const keep = new Set<string>();
      for (const r of rows) {
        if (!r.loc) continue;
        keep.add(r.d.id);
        const color = r.driving ? "#15803d" : APP_STATE[r.d.app.state].color;
        let m = markers.current.get(r.d.id);
        if (!m) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "driver-pin";
          el.setAttribute("aria-label", `${r.d.name} on the map`);
          el.addEventListener("click", () => {
            setSelected(r.d.id);
            if (r.d.deviceId) onFocus(r.d.deviceId);
          });
          m = new ml.Marker({ element: el, anchor: "bottom" }).setLngLat([r.loc.longitude, r.loc.latitude]).addTo(map);
          markers.current.set(r.d.id, m);
        }
        const el = m.getElement();
        el.innerHTML = "";
        const ring = document.createElement("span");
        ring.className = "driver-pin-ring";
        ring.style.borderColor = color;
        ring.textContent = r.d.name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]!.toUpperCase())
          .join("");
        const tag = document.createElement("span");
        tag.className = "driver-pin-tag";
        tag.style.borderTopColor = color;
        tag.textContent = `${r.d.name.split(" ")[0]}${r.d.vehicle ? ` · ${r.d.vehicle.name}` : ""}`;
        const sub = document.createElement("small");
        sub.textContent = r.driving ? u.fmtSpeed(r.speed) : r.d.source === "phone" ? "Phone" : "Stopped";
        tag.appendChild(sub);
        el.append(ring, tag);
        el.dataset.selected = String(selected === r.d.id);
        m.setLngLat([r.loc.longitude, r.loc.latitude]);
      }
      for (const [id, m] of markers.current) {
        if (keep.has(id)) continue;
        m.remove();
        markers.current.delete(id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [map, rows, selected, onFocus, u]);
  useEffect(
    () => () => {
      for (const m of markers.current.values()) m.remove();
      markers.current.clear();
    },
    []
  );

  const TABS: { k: DFilter; label: string; color: string }[] = [
    { k: "all", label: "All", color: "#0a2463" },
    { k: "driving", label: "Driving", color: "#15803d" },
    { k: "stopped", label: "Stopped", color: "#6d28d9" },
    { k: "location_off", label: "Location off", color: "#b91c1c" },
    { k: "no_app", label: "No app", color: "#c2410c" }
  ];

  return (
    <>
      <div className="grid gap-2 border-b border-border bg-gradient-to-b from-background to-canvas px-3 pb-2.5">
        <div className="flex gap-1.5">
          <div className="min-w-0 flex-1">
            <SearchInput value={search} onChange={setSearch} placeholder="Driver, phone or truck" label="Search drivers" debounceMs={150} className="sm:w-full" />
          </div>
          <Link href="/drivers?invite=1" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[13px] font-semibold text-primary no-underline shadow-card hover:bg-muted">
            <Send className="size-4" aria-hidden="true" /> Invite
          </Link>
        </div>
        <div role="radiogroup" aria-label="Filter drivers" className="grid grid-cols-5 gap-1">
          {TABS.map((t) => {
            const on = filter === t.k;
            return (
              <button
                key={t.k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFilter(t.k)}
                className={cn("grid cursor-pointer justify-items-center gap-px rounded-lg border-0 px-0.5 py-1", on ? "text-white" : "text-foreground hover:brightness-95")}
                style={on ? { background: `linear-gradient(135deg, ${t.color}, color-mix(in srgb, ${t.color} 70%, #000))` } : { background: `color-mix(in srgb, ${t.color} 10%, var(--color-background))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${t.color} 30%, transparent)` }}
              >
                <span className="text-[15px] font-extrabold leading-[18px] tabular-nums" style={on ? undefined : { color: t.color }}>
                  {counts[t.k]}
                </span>
                <span className="truncate text-[10.5px] font-semibold">{t.label}</span>
              </button>
            );
          })}
        </div>
        <p className="m-0 text-[11.5px] text-muted-foreground">
          {sharing} of {rows.length} sharing location · always on while signed in
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas px-2 py-2">
        {!drivers ? (
          error ? (
            <p className="m-2 text-sm text-danger">{error}</p>
          ) : (
            <div className="grid gap-2 p-1" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          )
        ) : shown.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="m-0 text-sm font-semibold">{rows.length === 0 ? "No active drivers yet" : "No drivers in this view"}</p>
            <p className="m-0 mt-1 text-xs text-muted-foreground">{rows.length === 0 ? "Add drivers and invite them to the RIO GPS app." : "Try another filter or search."}</p>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label="Drivers">
            {shown.map(({ d, loc, driving, speed }) => {
              const color = driving ? "#15803d" : APP_STATE[d.app.state].color;
              const off = d.app.state === "location_off";
              const noApp = d.app.state === "no_app" || d.app.state === "signed_out";
              return (
                <li key={d.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelected(d.id);
                      if (d.deviceId && loc) onFocus(d.deviceId);
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && d.deviceId && loc) {
                        e.preventDefault();
                        setSelected(d.id);
                        onFocus(d.deviceId);
                      }
                    }}
                    className={cn("relative grid cursor-pointer grid-cols-[40px_minmax(0,1fr)] gap-2.5 overflow-hidden rounded-xl py-2.5 pl-3.5 pr-2.5", noApp && "border border-dashed")}
                    style={{
                      background: `linear-gradient(110deg, var(--color-background) 45%, color-mix(in srgb, ${color} 10%, var(--color-background)))`,
                      boxShadow: selected === d.id ? `inset 0 0 0 2px ${color}` : `inset 0 0 0 1px color-mix(in srgb, ${color} 28%, transparent)`,
                      borderColor: noApp ? color : undefined
                    }}
                  >
                    <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r" style={{ background: color }} />
                    <span className="relative">
                      <DriverAvatar name={d.name} className="size-10 text-sm" />
                      <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background" style={{ background: color }} />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <b className="truncate text-[13.5px]">{d.name}</b>
                        {d.source && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10.5px] font-semibold text-muted-foreground" title={d.source === "tracker" ? "Location from the truck's tracker" : "Location from the driver's phone"}>
                            {d.source === "tracker" ? <Cpu className="size-3" aria-hidden="true" /> : <Smartphone className="size-3" aria-hidden="true" />}
                            {d.source === "tracker" ? "Tracker" : "Phone"}
                          </span>
                        )}
                        <span className="ml-auto shrink-0">{driving ? <span className="inline-flex h-5 items-center rounded-full bg-success-soft px-1.5 text-[11px] font-semibold text-success">Driving</span> : <AppStateChip state={d.app.state} className="h-5 px-1.5 text-[11px]" />}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">
                          {d.vehicle ? d.vehicle.name : "No truck"}
                          {driving ? ` · ${u.fmtSpeed(speed)}` : ""}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          <Battery pct={d.app.batteryPct} charging={d.app.charging} />
                          {loc && <RelativeTime iso={loc.recordedAt} />}
                        </span>
                      </span>
                      {!noApp && !off && !d.vehicle && <span className="w-fit rounded-md bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">No load · still on the map</span>}
                      {off && (
                        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <MapPinOff className="size-3.5 text-danger" aria-hidden="true" />
                          <span className="text-[11.5px] text-danger">Location is off on the phone</span>
                          {d.phone && (
                            <a href={`tel:${d.phone}`} onClick={(e) => e.stopPropagation()} className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold text-foreground no-underline">
                              <Phone className="size-3.5" aria-hidden="true" /> Call
                            </a>
                          )}
                        </span>
                      )}
                      {noApp && (
                        <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[11.5px] text-muted-foreground">{d.app.inviteSentAt ? <>Invite sent <RelativeTime iso={d.app.inviteSentAt} /></> : "Hasn't joined the driver app"}</span>
                          <Link href={`/drivers?invite=1`} onClick={(e) => e.stopPropagation()} className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold text-foreground no-underline">
                            <Send className="size-3.5" aria-hidden="true" /> {d.app.inviteSentAt ? "Resend invite" : "Invite"}
                          </Link>
                        </span>
                      )}
                      {!loc && !off && !noApp && (
                        <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden="true" /> No position yet
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="m-2 mt-3 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Drivers share location all the time while signed in to the driver app. When the truck has a tracker, we use it; the phone fills in otherwise.
        </p>
      </div>
    </>
  );
}
