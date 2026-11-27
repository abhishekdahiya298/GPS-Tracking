import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { offlineThresholdSeconds } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { getRequestContext } from "@/lib/request-context";
import { getTrackerDiagnostics } from "@/lib/tracker-diagnostics";
import { DiagnosticsView } from "./diagnostics-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tracker diagnostics · RIO GPS" };

/** Platform console → Trackers → one tracker: health, timeline, raw reports and read-only commands. */
export default async function TrackerDiagnosticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect(`/login?next=/admin/trackers/${id}`);
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  if (!z.string().uuid().safeParse(id).success) notFound();
  try {
    const data = await getTrackerDiagnostics(id, 24, offlineThresholdSeconds());
    return <DiagnosticsView initial={data} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
