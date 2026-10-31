import { platformWrite } from "@/lib/admin-route";
import { AppError } from "@/lib/errors";
import { syncHologramSims } from "@/lib/hologram";

export const dynamic = "force-dynamic";

/** "Sync now": refresh the SIM list from Hologram. */
export const POST = platformWrite("admin.sims.sync", null, async ({ user }) => {
  const r = await syncHologramSims(user.userId);
  if (!r) throw new AppError("SYNC_RUNNING", 409, "A sync is already running; try again in a minute.");
  return r;
});
