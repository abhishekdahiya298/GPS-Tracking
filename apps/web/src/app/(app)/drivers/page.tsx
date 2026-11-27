import { contextHasPermission } from "@rio-gps/core";
import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { DriverListQuery, listDriversPage } from "@/lib/drivers";
import { parseListQuery } from "@/lib/fleet-list";
import { requireTenantPage } from "@/lib/request-context";
import { companyJoinCode } from "@/lib/signup";
import { smsConfigured } from "@/lib/sms";
import { DriversTabs } from "./drivers-tabs";
import { DriversView } from "./drivers-view";
import { driversTabStats, loadsTabStats } from "./tabs-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Drivers · RIO GPS" };

export default async function DriversPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, orgName } = await requireTenantPage("/drivers");
  if (!contextHasPermission(ctx, "vehicles.read")) redirect("/dashboard");
  const sp = await searchParams;
  const q = parseListQuery(DriverListQuery, sp);
  const [data, loadsTab, vehicles] = await Promise.all([
    listDriversPage(ctx.organizationId, q),
    loadsTabStats(ctx),
    // The vehicle picker: every active vehicle, with who drives it now.
    getDb().execute<{ id: string; name: string; type: string; license_plate: string | null; driver: string | null }>(sql`
      select v.id, v.name, v.type, v.license_plate,
        (select d.name from drivers d where d.vehicle_id = v.id and d.organization_id = v.organization_id limit 1) as driver
      from vehicles v where v.organization_id = ${ctx.organizationId} and v.status <> 'inactive'
      order by lower(v.name) limit 2000`)
  ]);
  const can = {
    create: contextHasPermission(ctx, "vehicles.create"),
    update: contextHasPermission(ctx, "vehicles.update"),
    remove: contextHasPermission(ctx, "vehicles.delete"),
    map: contextHasPermission(ctx, "locations.read"),
    loads: contextHasPermission(ctx, "loads.write")
  };
  const joinCode = can.create ? await companyJoinCode(ctx.organizationId).catch(() => null) : null;
  return (
    <DriversView
      tabs={<DriversTabs active="drivers" drivers={driversTabStats(data.counts)} loads={loadsTab} />}
      joinCode={joinCode}
      companyName={orgName}
      smsReady={smsConfigured()}
      openInvite={sp.invite === "1"}
      data={data}
      query={q}
      can={can}
      vehicles={vehicles.map((v) => ({ id: v.id, name: v.name, type: v.type, licensePlate: v.license_plate, driver: v.driver }))}
    />
  );
}
