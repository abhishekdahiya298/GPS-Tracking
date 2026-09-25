/**
 * Backfill location_history for one device from Traccar's REST API.
 *
 *   docker compose ... exec -T web pnpm admin:backfill-history \
 *     --imei 864361078566115 --from 2026-09-24T00:00:00Z --to 2026-09-24T18:00:00Z [--dry-run]
 *
 * Idempotent: (device_id, recorded_at) is unique, so re-running over the same
 * window inserts nothing new. Uses the same schema validation and ingest path as
 * the live webhook, but never bumps last_seen_at and never publishes to Redis.
 * Talks to Traccar only through its REST API (never its database).
 */
import { parseArgs } from "node:util";
import { normalizePosition, TraccarForwardPositionSchema } from "@rio-gps/core";
import { closeDb } from "@rio-gps/db";
import { TraccarRestClient } from "@rio-gps/traccar-client";
import { ingestPosition } from "../src/lib/ingest";

const MAX_WINDOW_DAYS = 31;

async function main() {
  const { values } = parseArgs({
    options: {
      imei: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "dry-run": { type: "boolean", default: false }
    }
  });
  if (!values.imei || !values.from || !values.to) {
    console.error("Usage: backfill-history --imei <15 digits> --from <ISO> --to <ISO> [--dry-run]");
    process.exit(2);
  }
  const from = new Date(values.from);
  const to = new Date(values.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new Error("Invalid --from/--to");
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) throw new Error(`Window exceeds ${MAX_WINDOW_DAYS} days`);

  const { TRACCAR_API_URL, TRACCAR_API_USER, TRACCAR_API_PASSWORD } = process.env;
  if (!TRACCAR_API_URL || !TRACCAR_API_USER || !TRACCAR_API_PASSWORD) {
    throw new Error("TRACCAR_API_URL, TRACCAR_API_USER and TRACCAR_API_PASSWORD must be set");
  }
  const client = new TraccarRestClient({ baseUrl: TRACCAR_API_URL, username: TRACCAR_API_USER, password: TRACCAR_API_PASSWORD });
  const device = await client.findDeviceByUniqueId(values.imei);
  if (!device) throw new Error("Device not found in Traccar");

  const raw = await client.listPositions(device.id, from, to);
  const counts = { fetched: raw.length, invalid: 0, stored: 0, duplicate: 0, no_fix: 0, unknown_device: 0, device_inactive: 0, current_updated: 0 };
  for (const item of raw) {
    const parsed = TraccarForwardPositionSchema.safeParse(item);
    if (!parsed.success) {
      counts.invalid++;
      continue;
    }
    const position = normalizePosition({ position: parsed.data, device: { id: device.id, uniqueId: device.uniqueId } });
    if (values["dry-run"]) continue;
    const outcome = await ingestPosition(position, { touchLastSeen: false });
    counts[outcome.status]++;
    if (outcome.status === "stored" && outcome.currentUpdated) counts.current_updated++;
  }
  console.log(JSON.stringify({ event: "backfill.done", dryRun: values["dry-run"], from: from.toISOString(), to: to.toISOString(), ...counts }));
  if (counts.unknown_device > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("backfill-history failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
