# Reports

All reports are calculated on request from stored GPS history (`location_history`). Nothing
is pre-computed or written, and GPS data is never changed. Times and day boundaries use the
viewer's effective time zone (`TIME_ZONES.md`); distances and speeds use the organization's
units. Permission: `history.read`. Every query is scoped to the caller's organization.

| Report | Page | What it shows |
|---|---|---|
| Trips | `/reports` | Each trip for one vehicle: start, end, distance, driving/idle time, top speed |
| Stops | `/reports/stops` | Time parked between trips, and where. A vehicle parked now shows as "still stopped" |
| Idling | `/reports/idling` | Engine on while standing still (needs the tracker's ignition signal) |
| Speeding | `/reports/speeding` | Every stretch above a speed you choose (not the posted road limit) |
| Mileage | `/reports/mileage` | Distance and driving time per vehicle, per day and per month |

Stops, idling, speeding and mileage run for one vehicle or all vehicles, with CSV export and a
"Map" link that opens the live map's history around the event.

## Definitions (same engine as trips: `packages/core/src/trips.ts`, `activity.ts`)
- **Trip**: ignition on (or moving ≥ 5 km/h when ignition is unknown); ends after 5 minutes
  parked or a 20-minute gap in data.
- **Stop**: from the end of one trip to the start of the next. Default minimum 10 minutes.
- **Idling**: ignition on and speed < 3 km/h. A gap in data ends the period at the last idle
  point, so missing data is never counted. Default minimum 5 minutes.
- **Speeding**: consecutive readings above the limit. A single reading counts (duration 0),
  because trackers that report every few minutes would otherwise hide it. Readings above
  250 km/h are GPS glitches and are ignored.
- **Mileage**: distance along trips, each segment credited to the local day it starts in (a
  trip across midnight is split). The total equals the Trip report's for the same range.

## API
`GET /api/reports/activity?type=stops|idling|speeding|mileage&deviceId=<uuid>|all&from=&to=&tz=&minMinutes=&limitKph=&format=json|csv`
- `from`/`to`: ISO instants, at most `MAX_HISTORY_RANGE_DAYS` (31) apart.
- `tz` optional (defaults to the caller's zone); `limitKph` is always km/h.
- A device from another organization is a 404.

## Limits and speed
- Tracks are processed one vehicle at a time (memory bounded by 200,000 points per vehicle).
- One request may cover up to 2,000,000 GPS points. The size is checked first, so an
  oversized request fails immediately with a message that says how large it is.
- At most 5,000 rows are returned; totals and the per-vehicle table always cover everything.
- Measured locally (100 simulated trucks, a point every 30 s): 1 day (88k points) ≈ 0.7–1.2 s;
  7 days (617k points) ≈ 3.5–6 s.
- Next step for larger fleets: a daily per-vehicle summary table (planned with the dashboard
  charts) so mileage and dashboards don't re-read raw points.
