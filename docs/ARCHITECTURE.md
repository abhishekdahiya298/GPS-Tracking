# RIO GPS Tracking — Architecture (v0)

Standalone SaaS. No dependency on, import from, or connection to the existing RIO TMS.

## Data flow (v0)

```
FMM230 (Teltonika device)
  → SIM / cellular network
  → Traccar (Teltonika protocol decode, port 5027)
  → Traccar forward.url webhook (Authorization: Bearer <TRACCAR_WEBHOOK_SECRET>)
  → RIO web: POST /api/webhooks/traccar
      - verify shared secret
      - zod-validate + normalize payload (@rio-gps/traccar-client, @rio-gps/core)
      - look up GpsDevice by externalDeviceId
      - upsert CurrentLocations
      - publish to Redis channel rio:org:<orgId>:locations
  → RIO web: GET /api/locations/stream (SSE, session-scoped to caller's org)
  → Next.js live map (client)
```

No BullMQ in v0 — the webhook route writes directly to Postgres and Redis inline.
Add a queue when retry/backpressure/fan-out needs actually appear (see apps/worker).

## Database separation

One Postgres instance, two logical databases:

- `rio` — owned by this app, schema managed by Drizzle (`packages/db`).
- `traccar` — owned by Traccar, managed by Traccar itself. RIO never opens a
  connection to it. Traccar is only consumed through its REST API (admin
  lookups, `@rio-gps/traccar-client` `TraccarRestClient`) and its outgoing
  webhook (live position path).

## Device identity

Traccar's internal numeric `deviceId` is an integration detail and does not
appear outside `@rio-gps/traccar-client`. RIO's own identity for a device is:

```
GpsDevice.id                 -- RIO's uuid, primary key everywhere else in RIO
GpsDevice.externalDeviceId   -- provider's id for the device (Traccar's uniqueId)
GpsDevice.imei               -- hardware truth, unique, survives provider changes
GpsDevice.providerId         -- which GpsProvider row issued externalDeviceId
```

A device is matched on inbound webhook calls by `externalDeviceId`, not `imei`,
because that's what Traccar's payload carries per-position; `imei` is kept as
the durable cross-provider identity for future providers.

## Multi-tenant isolation

- Every RIO table carries `organizationId` (directly, or via a device/vehicle FK).
- `organizationId` is **never** accepted from client input (query param, body,
  header). It is derived server-side from the authenticated session — see
  `apps/web/src/lib/tenant.ts::getAuthenticatedSession`. Every authenticated
  route must call this rather than trust anything the client sent.
- The Traccar webhook route is the one exception: it's machine-to-machine,
  authenticated by a shared secret, and derives `organizationId` from the
  matched `GpsDevice` row, never from the request.
- Postgres Row-Level Security is a candidate defense-in-depth layer for a
  later milestone; not implemented in v0 (see open decisions in README).

## Extensibility notes

- `CurrentLocations` and the future append-only `LocationHistory` table are
  designed to share the same column set, so the ingest path can write to both
  without remapping fields once history lands.
- `GpsProvider` is a table, not a hardcoded string, so a second provider
  integration (beyond Traccar) doesn't require a `GpsDevice` schema change.
- `DeviceAssignment` already models assignment history (`unassignedAt`), so
  swapping a device between vehicles doesn't need a schema change later.
