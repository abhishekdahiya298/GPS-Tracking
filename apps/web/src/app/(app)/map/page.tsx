import { getDb, schema } from "@rio-gps/db";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { LiveMap } from "./live-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live map · RIO GPS" };

export default async function MapPage() {
  let ctx;
  try {
    const user = await requireAuthenticatedUserFromHeaders(await headers());
    ctx = await resolveTenantContext(user);
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/map");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  const [org] = await getDb()
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, ctx.organizationId));
  // Only display data goes to the client; all location data is fetched through
  // the session-authenticated APIs.
  return <LiveMap orgName={org?.name ?? "Organization"} />;
}
