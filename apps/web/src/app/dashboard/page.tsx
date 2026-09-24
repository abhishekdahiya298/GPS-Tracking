import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { SignOutButton } from "./sign-out-button";

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
    if (err instanceof AppError && err.status === 403) {
      return (
        <main style={{ fontFamily: "system-ui", padding: 24 }}>
          <p>Your account is not a member of any organization. Contact your administrator.</p>
          <SignOutButton />
        </main>
      );
    }
    throw err;
  }

  const db = getDb();
  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, ctx.organizationId));
  const devices = await db
    .select({ id: schema.gpsDevices.id, model: schema.gpsDevices.model, status: schema.gpsDevices.status })
    .from(schema.gpsDevices)
    .where(eq(schema.gpsDevices.organizationId, ctx.organizationId));

  return (
    <main style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{org?.name ?? "Organization"}</h1>
          <small>
            {user.email} · {ctx.role ?? "SUPER_ADMIN"}
          </small>
        </div>
        <SignOutButton />
      </header>
      <h2 style={{ fontSize: 18 }}>Devices ({devices.length})</h2>
      <ul>
        {devices.map((d) => (
          <li key={d.id}>
            {d.model ?? "Device"} — {d.status}
          </li>
        ))}
      </ul>
      <p style={{ color: "#666" }}>The live map arrives in a later phase.</p>
    </main>
  );
}
