import { platformWrite } from "@/lib/admin-route";
import { sendTrackerCommand } from "@/lib/tracker-diagnostics";
import { TrackerCommandSchema } from "@/lib/tracker-diagnostics-model";

export const dynamic = "force-dynamic";

/** Send one read-only command (allowlist) to a tracker. Rate limited per tracker; audited. */
export const POST = platformWrite("admin.trackers.command", TrackerCommandSchema, ({ user, ids, body, meta }) => sendTrackerCommand(user.userId, ids.id!, body.command, meta), { notFound: "Tracker not found" });
