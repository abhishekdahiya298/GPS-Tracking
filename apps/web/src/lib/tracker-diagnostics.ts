import { TraccarRestClient } from "@rio-gps/traccar-client";
import { getDb, schema } from "@rio-gps/db";
import { and, eq, isNull } from "drizzle-orm";
import { writeAudit } from "./audit";
import { AppError, NotFoundError } from "./errors";
import { logger } from "./logger";
import { assertRateLimit } from "./rate-limit";
import { hourlyBuckets, healthChecks, overallVerdict, toDiagReport, TRACKER_COMMANDS, commandPayload, type DiagReport, type HealthCheck, type HourBucket, type Level, type TrackerCommandId } from "./tracker-diagnostics-model";

/**
 * Tracker diagnostics for super admins (Platform console → Trackers → a tracker).
 *
 * Read-only and on demand: it reads Traccar's stored reports through Traccar's REST API only
 * when the page asks, for a bounded time range, and never touches the live position path
 * (Traccar webhook → ingest → Redis → maps). Commands are limited to an allowlist (no setting changes),
 * rate limited per tracker and written to the audit log.
 */

/** Longest time range one request may read (bounds Traccar query size). */
export const MAX_HOURS = 72;
/** Most reports returned to the page (newest kept). ~1 per minute for 72 h fits. */
export const MAX_REPORTS = 5_000;
/** Commands per tracker per minute. */
const COMMANDS_PER_MINUTE = 10;

/** The Traccar calls diagnostics need; swappable in tests. */
export interface TraccarDiagnosticsClient {
  findDeviceByUniqueId(uniqueId: string): Promise<{ id: number; status: string; lastUpdate?: string | null } | null>;
  listPositions(deviceId: number, from: Date, to: Date): Promise<unknown[]>;
  sendCommand(deviceId: number, data: string): Promise<"sent" | "queued">;
}

let override: TraccarDiagnosticsClient | null = null;
export function setTraccarDiagnosticsForTests(t: TraccarDiagnosticsClient | null) {
  override = t;
}

function traccar(): TraccarDiagnosticsClient {
  if (override) return override;
  const { TRACCAR_API_URL, TRACCAR_API_USER, TRACCAR_API_PASSWORD } = process.env;
  if (!TRACCAR_API_URL || !TRACCAR_API_USER || !TRACCAR_API_PASSWORD) throw new AppError("TRACCAR_NOT_CONFIGURED", 409, "Traccar API credentials are not configured on the server.");
  return new TraccarRestClient({ baseUrl: TRACCAR_API_URL, username: TRACCAR_API_USER, password: TRACCAR_API_PASSWORD });
}

export interface DiagnosticsTracker {
  id: string;
  imei: string;
  externalDeviceId: string;
  name: string | null;
  model: string | null;
  serialNumber: string | null;
  status: string;
  lastSeenAt: string | null;
  customer: { id: string; name: string } | null;
  vehicle: { id: string; name: string; type: string } | null;
  sim: { iccid: string; msisdn: string | null; status: string; plan: string | null; provider: string | null } | null;
  /** Newest usable position RIO stored (may be older than the time range). */
  lastFix: { at: string; latitude: number; longitude: number } | null;
}

export interface TrackerDiagnostics {
  tracker: DiagnosticsTracker;
  range: { from: string; to: string; hours: number };
  /** Traccar's view; `error` when it couldn't be read (the rest of the page still works). */
  traccar: { connected: boolean; lastMessageAt: string | null; protocol: string | null; error: string | null };
  verdict: { level: Level; title: string; detail: string };
  checks: HealthCheck[];
  latest: DiagReport | null;
  buckets: HourBucket[];
  /** Newest first, at most 60. */
  recent: DiagReport[];
  /** Command replies in the range, newest first. */
  replies: { at: string; text: string }[];
  totals: { reports: number; fixes: number; truncated: boolean };
}

async function loadTracker(id: string): Promise<DiagnosticsTracker> {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.gpsDevices.id,
      imei: schema.gpsDevices.imei,
      externalDeviceId: schema.gpsDevices.externalDeviceId,
      name: schema.gpsDevices.name,
      model: schema.gpsDevices.model,
      serialNumber: schema.gpsDevices.serialNumber,
      status: schema.gpsDevices.status,
      lastSeenAt: schema.gpsDevices.lastSeenAt,
      orgId: schema.organizations.id,
      orgName: schema.organizations.name
    })
    .from(schema.gpsDevices)
    .leftJoin(schema.organizations, eq(schema.organizations.id, schema.gpsDevices.organizationId))
    .where(eq(schema.gpsDevices.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("Tracker not found");

  const [[vehicle], [sim], [fix]] = await Promise.all([
    db
      .select({ id: schema.vehicles.id, name: schema.vehicles.name, type: schema.vehicles.type })
      .from(schema.deviceAssignments)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.deviceAssignments.vehicleId))
      .where(and(eq(schema.deviceAssignments.deviceId, id), isNull(schema.deviceAssignments.unassignedAt)))
      .limit(1),
    db
      .select({ iccid: schema.simCards.iccid, msisdn: schema.simCards.msisdn, status: schema.simCards.status, plan: schema.simCards.plan, provider: schema.simCards.provider })
      .from(schema.simCards)
      .where(eq(schema.simCards.deviceId, id))
      .limit(1),
    db
      .select({ at: schema.currentLocations.recordedAt, latitude: schema.currentLocations.latitude, longitude: schema.currentLocations.longitude })
      .from(schema.currentLocations)
      .where(eq(schema.currentLocations.deviceId, id))
      .limit(1)
  ]);

  return {
    id: row.id,
    imei: row.imei,
    externalDeviceId: row.externalDeviceId,
    name: row.name,
    model: row.model,
    serialNumber: row.serialNumber,
    status: row.status,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    customer: row.orgId && row.orgName ? { id: row.orgId, name: row.orgName } : null,
    vehicle: vehicle ?? null,
    sim: sim ?? null,
    lastFix: fix ? { at: fix.at.toISOString(), latitude: Number(fix.latitude), longitude: Number(fix.longitude) } : null
  };
}

const reportTime = (r: DiagReport) => Date.parse(r.at);

/** Everything the diagnostics page shows for one tracker over the last `hours` hours. */
export async function getTrackerDiagnostics(id: string, hours: number, offlineSeconds: number, now = new Date()): Promise<TrackerDiagnostics> {
  const h = Math.min(MAX_HOURS, Math.max(1, Math.round(hours)));
  const to = now;
  const from = new Date(now.getTime() - h * 3_600_000);
  const tracker = await loadTracker(id);

  let reports: DiagReport[] = [];
  let truncated = false;
  const tc: TrackerDiagnostics["traccar"] = { connected: false, lastMessageAt: null, protocol: null, error: null };
  try {
    const client = traccar();
    const device = await client.findDeviceByUniqueId(tracker.externalDeviceId);
    if (!device) tc.error = "This tracker is not registered in Traccar.";
    else {
      tc.connected = device.status === "online";
      tc.lastMessageAt = device.lastUpdate ?? null;
      const raw = await client.listPositions(device.id, from, to);
      reports = raw
        .map(toDiagReport)
        .filter((r): r is DiagReport => r !== null)
        .sort((a, b) => reportTime(a) - reportTime(b));
      if (reports.length > MAX_REPORTS) {
        truncated = true;
        reports = reports.slice(-MAX_REPORTS);
      }
      tc.protocol = reports.find((r) => r.protocol)?.protocol ?? null;
    }
  } catch (err) {
    tc.error = err instanceof AppError ? err.message : "Couldn't read Traccar right now. Try again in a moment.";
    if (!(err instanceof AppError)) logger.warn("diagnostics.traccar_failed", { trackerId: id }, err);
  }

  const newestFixInRange = [...reports].reverse().find((r) => r.fix)?.at ?? null;
  const lastFixAt = [newestFixInRange, tracker.lastFix?.at ?? null].filter((v): v is string => !!v).sort().pop() ?? null;
  const lastSeenAt = [tracker.lastSeenAt, tc.lastMessageAt].filter((v): v is string => !!v).sort().pop() ?? null;
  const checks = healthChecks({ now: now.getTime(), lastSeenAt, reports, lastFixAt, offlineSeconds });

  return {
    tracker,
    range: { from: from.toISOString(), to: to.toISOString(), hours: h },
    traccar: tc,
    verdict: overallVerdict(checks),
    checks,
    // Newest real report: a command reply is stored as a position with only the reply text.
    latest: [...reports].reverse().find((r) => r.result === null) ?? reports[reports.length - 1] ?? null,
    buckets: hourlyBuckets(reports, from, to),
    recent: reports.slice(-60).reverse(),
    replies: reports
      .filter((r) => r.result)
      .reverse()
      .slice(0, 30)
      .map((r) => ({ at: r.receivedAt, text: r.result! })),
    totals: { reports: reports.length, fixes: reports.filter((r) => r.fix).length, truncated }
  };
}

/** Command replies received since `since` (the page polls this right after sending). */
export async function getCommandReplies(id: string, since: Date, now = new Date()): Promise<{ at: string; text: string }[]> {
  const tracker = await loadTracker(id);
  const from = new Date(Math.max(since.getTime() - 60_000, now.getTime() - 3_600_000));
  const client = traccar();
  const device = await client.findDeviceByUniqueId(tracker.externalDeviceId);
  if (!device) return [];
  const raw = await client.listPositions(device.id, from, new Date(now.getTime() + 60_000));
  return raw
    .map(toDiagReport)
    .filter((r): r is DiagReport => r !== null && r.result !== null && Date.parse(r.receivedAt) >= since.getTime())
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
    .map((r) => ({ at: r.receivedAt, text: r.result! }));
}

/** Sends one allowlisted command to the tracker (see TRACKER_COMMANDS). Rate limited per tracker; audited. */
export async function sendTrackerCommand(
  actorUserId: string,
  id: string,
  command: TrackerCommandId,
  meta: { ipAddress: string | null; userAgent: string | null }
): Promise<{ status: "sent" | "queued"; sentAt: string; command: TrackerCommandId }> {
  if (!TRACKER_COMMANDS.some((c) => c.id === command)) throw new AppError("COMMAND_NOT_ALLOWED", 400, "That command isn't allowed here.");
  const tracker = await loadTracker(id);
  await assertRateLimit("tracker_cmd", id, COMMANDS_PER_MINUTE, 60, "Too many commands to this tracker. Wait a minute and try again.");
  const client = traccar();
  const device = await client.findDeviceByUniqueId(tracker.externalDeviceId);
  if (!device) throw new AppError("TRACCAR_DEVICE_MISSING", 409, "This tracker is not registered in Traccar.");
  const sentAt = new Date();
  let status: "sent" | "queued";
  try {
    status = await client.sendCommand(device.id, commandPayload(command));
  } catch (err) {
    logger.warn("diagnostics.command_failed", { trackerId: id, command }, err);
    throw new AppError("TRACCAR_UNAVAILABLE", 502, "Traccar didn't accept the command. Try again in a moment.");
  }
  await writeAudit({
    action: "device.command_sent",
    actorUserId,
    organizationId: null,
    targetType: "gps_device",
    targetId: id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { imei: tracker.imei, command, outcome: status }
  });
  return { status, sentAt: sentAt.toISOString(), command };
}
