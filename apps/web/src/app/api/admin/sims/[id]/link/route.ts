import { platformWrite } from "@/lib/admin-route";
import { linkSim, SimLinkSchema } from "@/lib/sims";

export const dynamic = "force-dynamic";

/** POST { imei } to put the SIM in that tracker, { imei: null } to take it out. */
export const POST = platformWrite("admin.sims.link", SimLinkSchema, ({ user, ids, body, meta }) => linkSim(user.userId, ids.id!, body, meta), { notFound: "SIM not found" });
