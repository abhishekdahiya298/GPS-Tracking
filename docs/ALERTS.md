# Zones and alerts

## Zones (`/zones` → `/geofences`)

A zone is either a **circle** (a center plus a radius of 20 m – 50 km) or a **polygon** (3–200 corners), drawn on the map. Zone checks are plain geometry in the app (`packages/core/src/geo.ts`); no PostGIS is needed.

Permissions: `geofences.read` to view zones, `geofences.write` to create or delete them. Deleting a zone also deletes the rules that use it; past alert events are kept.

## Rules (`/alerts`)

| Type | Fires when | Settings |
|---|---|---|
| Enters zone / Leaves zone | the vehicle crosses the zone boundary | zone |
| Speeding | speed goes above the limit; re-arms after dropping 5 km/h below it | limit km/h |
| Ignition on / off | the ignition changes state | – |
| Device offline | no data for N minutes (checked every 60 s) | minutes (use ≥ 90 for a parked FTM880, which reports hourly) |

A rule applies to **all vehicles** or to one vehicle.

Rules are **edge-triggered**. Each (rule, device) pair keeps its own state in `alert_rule_state`, so an alert fires once per transition. The first observation after a rule is created only records where the vehicle is and never fires.

**Evaluation:**

- Rules run after a position is committed, and only for the newest position of a device. Late backlog points are stored in history but don't fire alerts.
- A failure in alert processing is logged (`alerts.evaluate_failed`) and never fails GPS ingest.

**Offline check:** runs inside the web process every 60 s, protected by a Postgres transaction-level advisory lock, so it stays single-runner even with several processes. Set `ALERTS_SCHEDULER_ENABLED=false` to turn it off.

## Delivery

**Live:** new events are published to Redis `rio:org:<id>:alerts` and delivered over the existing SSE stream as `event: alert`, to users with `alerts.read`. They appear as:

- pop-up notices on the live map
- a counter next to the Alerts link
- entries added live to the Alerts page

**Email:** optional, per rule. It goes to members with the roles ORG_ADMIN, FLEET_MANAGER and DISPATCHER, at most one email per (rule, device) every 5 minutes.

**Acknowledge:** `alerts.write` can acknowledge one alert or all of them (`POST /api/alerts/acknowledge`). Acknowledgement only ever affects the caller's own organization.

## API

| Endpoint | Permission |
|---|---|
| `GET/POST /api/geofences`, `PATCH/DELETE /api/geofences/:id` | geofences.read / geofences.write |
| `GET/POST /api/alert-rules`, `PATCH/DELETE /api/alert-rules/:id` | alerts.read / alerts.write |
| `GET /api/alerts?limit=&unacknowledged=1&beforeId=` | alerts.read |
| `POST /api/alerts/acknowledge` `{ids}` or `{all:true}` | alerts.write |

Every referenced id (zone, vehicle, rule, event) is matched inside the caller's organization. An id from another organization behaves exactly like one that doesn't exist (404).
