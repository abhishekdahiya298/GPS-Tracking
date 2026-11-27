"use client";
import { MapPin, Package } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { RelativeTime } from "@/components/app/local-time";
import { FilterBar, SegmentedFilter } from "@/components/app/filter-bar";
import { SearchInput } from "@/components/app/search-input";
import { EmptyState } from "@/components/app/states";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { displayPhone } from "@rio-gps/core/phone";
import { cn } from "@/lib/cn";
import type { listPlatformDrivers, PlatformDriverRow } from "@/lib/platform-drivers";
import { placeText, useAddressState } from "@/lib/use-address";
import { DriverAvatar } from "@/app/(app)/drivers/drivers-view";

type Data = Awaited<ReturnType<typeof listPlatformDrivers>>;
const APP: Record<PlatformDriverRow["app"], { label: string; cls: string }> = {
  on: { label: "App on", cls: "bg-success-soft text-success" },
  location_off: { label: "Location off", cls: "bg-danger-soft text-danger" },
  signed_out: { label: "Signed out", cls: "bg-muted text-muted-foreground" },
  not_joined: { label: "Not joined", cls: "bg-warning-soft text-warning" }
};

function Where({ d }: { d: PlatformDriverRow }) {
  const a = useAddressState(d.latitude, d.longitude, false);
  if (d.latitude == null || d.longitude == null) return <span className="text-xs text-muted-foreground">No location shared</span>;
  return (
    <span className="grid min-w-0 text-xs">
      <span className="flex items-start gap-1">
        <MapPin className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden="true" />
        <span className="line-clamp-2">{placeText(a, d.latitude, d.longitude)}</span>
      </span>
      {d.lastAt && (
        <span className="text-[11px] text-muted-foreground">
          Phone · <RelativeTime iso={d.lastAt} />
        </span>
      )}
    </span>
  );
}

/** Console → All drivers (C21): one row per person, every company link shown as a chip. */
export function PlatformDriversView({ data, filter, search }: { data: Data; filter: string; search: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const go = (next: { filter?: string; q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const f = next.filter ?? filter;
    const q = next.q ?? search;
    if (f !== "all") sp.set("filter", f);
    if (q) sp.set("q", q);
    if (next.page && next.page > 1) sp.set("page", String(next.page));
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };
  const c = data.counts;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <Card>
      <FilterBar>
        <SegmentedFilter
          label="Show"
          value={filter}
          onChange={(v) => go({ filter: v, page: 1 })}
          options={[
            { value: "all", label: "All", count: c.all },
            { value: "company", label: "In a company", count: c.company },
            { value: "independent", label: "Independent", count: c.independent },
            { value: "app_on", label: "App on", count: c.app_on },
            { value: "location_off", label: "Location off", count: c.location_off },
            { value: "not_joined", label: "Not joined", count: c.not_joined }
          ]}
        />
        <SearchInput value={search} onChange={(v) => go({ q: v, page: 1 })} placeholder="Name, phone or company" label="Search drivers" className="sm:ml-auto" />
      </FilterBar>
      {data.items.length === 0 ? (
        <EmptyState icon={Package} title="No drivers here" description="Try another filter or search." />
      ) : (
        <Table className="min-w-[1000px] table-fixed">
          <THead>
            <TR>
              <TH style={{ width: "22%" }}>Driver</TH>
              <TH style={{ width: "24%" }}>Companies</TH>
              <TH style={{ width: "10%" }}>App</TH>
              <TH style={{ width: "24%" }}>Last location</TH>
              <TH style={{ width: "12%" }}>Load now</TH>
              <TH style={{ width: "8%" }}>Joined</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.map((d) => (
              <TR key={d.key}>
                <TD className="py-2">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <DriverAvatar name={d.name} className="size-8 text-xs" />
                    <span className="grid min-w-0">
                      <b className="truncate text-[13.5px]">{d.name}</b>
                      <span className="text-xs text-muted-foreground">{d.phone ? displayPhone(d.phone) : "No phone"}</span>
                    </span>
                  </span>
                </TD>
                <TD className="py-2">
                  <span className="flex flex-wrap gap-1">
                    {d.companies.map((co) => (
                      <Link key={co.id} href={co.independent ? "#" : `/admin/customers/${co.id}`} className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold no-underline", co.independent ? "bg-muted text-muted-foreground" : co.link === "pending" ? "bg-warning-soft text-warning" : "bg-primary-soft text-primary")}>
                        {co.independent ? "Independent" : `${co.name}${co.link === "pending" ? " · invited" : co.link === "left" ? " · left" : ""}`}
                      </Link>
                    ))}
                  </span>
                </TD>
                <TD className="py-2">
                  <span className={cn("inline-flex h-5 items-center rounded-full px-2 text-[11px] font-bold", APP[d.app].cls)}>{APP[d.app].label}</span>
                </TD>
                <TD className="py-2">
                  <Where d={d} />
                </TD>
                <TD className="py-2 text-xs">{d.load ? `${d.load.reference} · ${d.load.status.replace(/_/g, " ")}` : <span className="text-muted-foreground">—</span>}</TD>
                <TD className="py-2 text-xs text-muted-foreground">
                  <RelativeTime iso={d.joinedAt} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        Page {data.page} of {pages} · {data.total.toLocaleString("en-US")} drivers
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => go({ page: data.page - 1 })}>
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={data.page >= pages} onClick={() => go({ page: data.page + 1 })}>
            Next
          </Button>
        </span>
      </div>
    </Card>
  );
}
