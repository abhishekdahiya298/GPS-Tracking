"use client";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { SearchInput } from "@/components/app/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";

interface Option {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Server-searched single-choice list (≤ 20 results), so pickers stay fast with
 * thousands of vehicles or devices.
 */
function RemotePicker({ fetchOptions, value, onChange, label, emptyText }: { fetchOptions: (search: string) => Promise<Option[]>; value: string | null; onChange: (id: string) => void; label: string; emptyText: string }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<Option[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setOptions(null);
    fetchOptions(search)
      .then((o) => live && setOptions(o))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [search, fetchOptions]);
  return (
    <div className="grid gap-2">
      <SearchInput value={search} onChange={setSearch} label={`Search ${label}`} placeholder={`Search ${label}…`} className="sm:w-full" />
      <div role="listbox" aria-label={label} className="max-h-64 overflow-y-auto rounded-md border border-border">
        {error && <p className="m-0 p-3 text-sm text-danger">{error}</p>}
        {!options && !error && (
          <div className="grid gap-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        {options?.length === 0 && <p className="m-0 p-3 text-sm text-muted-foreground">{emptyText}</p>}
        {options?.map((o) => (
          <button
            key={o.id}
            type="button"
            role="option"
            aria-selected={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn("flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border bg-transparent px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-canvas", value === o.id && "bg-primary-soft")}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{o.label}</span>
              {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
            </span>
            {value === o.id && <Check className="size-4 text-primary" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

type DeviceItem = { id: string; name: string | null; model: string | null; imeiLast4?: string; vehicle: { name: string } | null };
type VehicleItem = { id: string; name: string; licensePlate: string | null; device: { name: string | null; model: string | null } | null };

const fetchDevices = async (search: string) => {
  const r = await api<{ items: DeviceItem[] }>(`/api/devices?${new URLSearchParams({ search, pageSize: "10", sort: "name" })}`);
  return r.items.map((d) => ({
    id: d.id,
    label: d.name ?? d.model ?? "Device",
    hint: [d.model && d.name ? d.model : null, d.imeiLast4 ? `IMEI …${d.imeiLast4}` : null, d.vehicle ? `on ${d.vehicle.name}` : "not assigned"].filter(Boolean).join(" · ")
  }));
};
const fetchVehicles = async (search: string) => {
  const r = await api<{ items: VehicleItem[] }>(`/api/vehicles?${new URLSearchParams({ search, pageSize: "10", sort: "name" })}`);
  return r.items.map((v) => ({ id: v.id, label: v.name, hint: [v.licensePlate, v.device ? `has ${v.device.name ?? v.device.model ?? "a device"}` : "no device"].filter(Boolean).join(" · ") }));
};

export function DevicePicker(props: { value: string | null; onChange: (id: string) => void }) {
  return <RemotePicker {...props} fetchOptions={fetchDevices} label="devices" emptyText="No devices match. Devices are registered by RIO support." />;
}
export function VehiclePicker(props: { value: string | null; onChange: (id: string) => void }) {
  return <RemotePicker {...props} fetchOptions={fetchVehicles} label="vehicles" emptyText="No vehicles match." />;
}
