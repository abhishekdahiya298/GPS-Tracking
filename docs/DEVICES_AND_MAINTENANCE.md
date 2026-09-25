# Device management and maintenance reminders

## Device management (`/vehicles`, Org Admin: `devices.manage`)

- **Rename**: a customer-facing label (`gps_devices.name`), shown on the map, dashboard,
  reports and emails when the device isn't on a vehicle. RIO only; Traccar's name is unchanged.
- **Deactivate / Reactivate**: status `inactive` ↔ `active`. While inactive, the Traccar
  webhook is answered `202 ignored (device inactive)` (so Traccar doesn't retry) and nothing
  is stored: no history, no live position, no alerts, hidden from the live map. `last_seen`
  still updates (the hardware is alive). History recorded before stays available in reports.
- `retired` devices (platform decision) can't be reactivated by customers (409).
- Org Admins see the IMEI's last 4 digits to tell identical trackers apart; the full IMEI is
  never sent to the browser. Audit: `device.renamed`, `device.deactivated`, `device.reactivated`.

## Maintenance reminders (`/maintenance`; read: all roles, write: Org Admin + Fleet Manager)

- An item belongs to a vehicle and is due by distance (`interval_km`), time
  (`interval_days`) or both, whichever comes first.
- **Distance** = km driven since the last service, computed in SQL from
  `location_history.vehicle_id` (so it follows the vehicle across tracker swaps). Only moving
  segments count (ignition on or ≥ 5 km/h at either end), segments > 250 km/h or with a gap
  > 20 min are dropped, which matches the trip-report rules and ignores parked GPS drift.
- **States**: `ok`, `due_soon` (at 90 % of the interval, at least 7 days / 300 km before),
  `overdue`. The dashboard shows a count and an overdue banner.
- **Emails**: every 15 min the scheduler emails the chosen members (re-checked as org members)
  once per transition into `due_soon` and again into `overdue`. Claimed with a
  compare-and-set on `notified_state` so several instances never double-send. While email is
  disabled, the transition stays pending.
- **Mark serviced** stores a record (date, optional odometer, km since previous, note) and
  restarts the interval. Changing an interval resets the notification state.
- API: `GET/POST /api/maintenance`, `PATCH/DELETE /api/maintenance/{id}`,
  `POST /api/maintenance/{id}/service`. Audit: `maintenance.created/updated/deleted/serviced`.

Migration `0005_devices_maintenance` is additive: `gps_devices.name` (nullable) plus the
`maintenance_items` and `maintenance_records` tables.
