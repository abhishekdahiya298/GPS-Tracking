# Location data: ingest and read APIs

## Ingest (Traccar → RIO)

Traccar POSTs every position to `/api/webhooks/traccar`. This path is internal only; Caddy returns 404 for it publicly. The request carries `Authorization: Bearer <TRACCAR_WEBHOOK_SECRET>`.

For a known device, each record goes through these steps (`apps/web/src/lib/ingest.ts`):

1. `gps_devices.last_seen_at` is set to now. This happens even when the record has no GNSS fix; it drives online/offline.
2. One transaction runs:
   - The record is appended to `location_history`. Because `(device_id, recorded_at)` is unique, a redelivery is a no-op.
   - `current_locations` is upserted only if the record is strictly newer. A late backlog record lands in history only.
3. After commit, and only if the current location changed, an event is published on Redis `org:<id>:locations` and fanned out over SSE.

Responses:

- `200` stored and published.
- `202` duplicate, late (history only), no fix, or unknown device. Traccar does not retry these.
- `503` the database write failed and nothing was committed. Traccar may retry.

## Read APIs (session required)

Every read API derives the organization from the session. None accepts one from the client.

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /api/locations/current` | `locations.read` | Every device in the org: vehicle (active assignment), `connectivity` (`online`/`offline`/`never_seen`, threshold `GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS`, default 3900 s), `lastSeenAt`, and the latest `location` |
| `GET /api/locations/history?deviceId=&from=&to=&limit=&cursor=` | `history.read` | Time-ordered points in `[from, to)`. Defaults to the last 24 h. The window is capped by `MAX_HISTORY_RANGE_DAYS` (31). `limit` is 1–5000 (default 2000). Keyset pagination uses `nextCursor`. A device from another org returns the same 404 as a missing one |
| `GET /api/locations/stream` | `locations.read` | SSE, described below |

Provider identities (IMEI, Traccar IDs) are not included in API responses.

## Live stream (SSE)

Events, in order:

1. `snapshot`: `{ generatedAt, devices }`, the same shape as `/current`. It is sent first on every connect and reconnect, so a client never misses the current state.
2. `location`: one event per accepted newer fix. The data is the point shape plus `deviceId` and `receivedAt`. Clients should ignore an event older than the location they already hold.
3. `end`: `{ reason }`, sent just before the server closes the stream. Reasons:
   - `session_ended` (sign-out, expired session, or membership removed): go to `/login`.
   - `organization_changed`, `max_lifetime` or `unavailable`: reconnect.

A keep-alive comment is sent every `SSE_HEARTBEAT_SECONDS`.

Limits and checks, per web process:

- **Shared subscription:** one Redis subscriber per organization channel, shared by all of that organization's streams.
- **Session re-check:** every `SSE_SESSION_RECHECK_SECONDS` (default 60).
- **Maximum lifetime:** `SSE_MAX_LIFETIME_SECONDS` (default 3600).
- **Per-user cap:** `SSE_MAX_STREAMS_PER_USER` (default 10) concurrent streams. Over the cap, the request gets 429.

## Live map

`/map` needs a session and uses MapLibre GL with OpenFreeMap tiles; no API key.

- **Device list:** each device's status and last fix. The list is filled from the SSE snapshot and then updated live.
- **History:** pick a device and a time range, then play back the track (up to 20,000 points per load).

The map itself never receives organization IDs or credentials. All data comes from the session-authenticated APIs.

## Backfill from Traccar

Use this to import positions Traccar holds that RIO never stored, such as drives from before history existed. It reads Traccar's REST API, never its database. It is idempotent, and it does not change `last_seen_at` or publish live events.

```bash
docker compose --env-file .env -f infra/docker-compose.yml exec -T web \
  pnpm admin:backfill-history --imei 864361078566115 \
  --from 2026-09-23T00:00:00Z --to 2026-09-25T00:00:00Z [--dry-run]
```
