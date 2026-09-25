import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuthenticatedUserFromHeaders, resolveTenantContext } from "@/lib/authz";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { LiveMap } from "./live-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live tracking · RIO GPS" };

export default async function MapPage() {
  try {
    await resolveTenantContext(await requireAuthenticatedUserFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect("/login?next=/map");
    if (err instanceof AppError && err.status === 403) redirect("/dashboard");
    throw err;
  }
  // No location data is rendered on the server: the client loads it through the
  // session-authenticated stream, scoped to the caller's organization.
  return <LiveMap offlineSeconds={getServerEnv().GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS} />;
}
