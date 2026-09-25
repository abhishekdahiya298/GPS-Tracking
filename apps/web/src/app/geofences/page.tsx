import { contextHasPermission } from "@rio-gps/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listGeofences } from "@/lib/alerts";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { GeofenceEditor } from "./geofence-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zones · RIO GPS" };

export default async function GeofencesPage() {
  let ctx;
  try {
    ctx = await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/geofences");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  if (!contextHasPermission(ctx, "geofences.read")) redirect("/dashboard");
  return <GeofenceEditor initial={await listGeofences(ctx.organizationId)} canWrite={contextHasPermission(ctx, "geofences.write")} />;
}
