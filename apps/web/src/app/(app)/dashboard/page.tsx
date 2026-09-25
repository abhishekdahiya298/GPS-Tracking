import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { listCurrentLocations } from "@/lib/locations";
import { dueCounts } from "@/lib/maintenance";
import { contextHasPermission } from "@rio-gps/core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · RIO GPS" };

export default async function DashboardPage() {
  let user;
  let ctx;
  try {
    user = await requireAuthenticatedUserFromHeaders(await headers());
    ctx = await resolveTenantContext(user);
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/dashboard");
    if (err instanceof AppError && err.status === 403) redirect("/login");
    throw err;
  }

  const db = getDb();
  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, ctx.organizationId));
  const maint = contextHasPermission(ctx, "maintenance.read") ? await dueCounts(ctx.organizationId) : null;
  const devices = await listCurrentLocations(ctx.organizationId, new Date(), getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{org?.name ?? "Organization"}</h1>
          <small>
            {user.email} · {ctx.role ?? "SUPER_ADMIN"}
          </small>
        </div>
      </header>
      {maint && maint.overdue > 0 && (
        <p style={{ background: "#fde8e8", color: "#a61b1b", padding: 8, borderRadius: 6 }}>
          {maint.overdue} maintenance item{maint.overdue === 1 ? "" : "s"} overdue. <a href="/maintenance">Review</a>
        </p>
      )}
      <h2 style={{ fontSize: 18 }}>Devices ({devices.length})</h2>
      <ul>
        {devices.map((d) => (
          <li key={d.deviceId}>
            <strong>{d.vehicle?.name ?? d.name ?? d.model ?? "Device"}</strong> — {d.connectivity.replace("_", " ")}
            {d.location && (
              <>
                {" "}
                · last fix {new Date(d.location.recordedAt).toUTCString()} ({d.location.latitude.toFixed(5)},{" "}
                {d.location.longitude.toFixed(5)}){d.location.ignition === true ? " · ignition on" : d.location.ignition === false ? " · ignition off" : ""}
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
