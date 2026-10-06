# Renewal reminders

Dated renewals that have nothing to do with distance driven: plate registration, insurance,
safety inspection, permits, a driver's licence. They live beside service reminders under
**Maintenance → Renewals** (`/maintenance/renewals`).

- A renewal belongs to one vehicle or to the whole company.
- **State** comes from calendar days in the organization's time zone: *OK* → *Due soon*
  (within the reminder window, default 30 days, and on the due date itself) → *Expired*
  (from the day after).
- **Mark renewed** asks for the new expiry date (suggests one year later) and starts the
  reminders over.
- **Emails**: the people chosen on the renewal get one email when it becomes due soon and
  one when it expires. The check runs with the maintenance scheduler (every 15 minutes);
  each state change is claimed atomically, so it is sent once.
- The dashboard shows a banner when renewals are expired or due soon, and the Maintenance
  tabs show a count.

Permissions: `maintenance.read` to see, `maintenance.write` to change (Org Admin, Fleet
Manager).

## Data (migration 0010, additive)
`renewal_reminders`: organization_id, vehicle_id (nullable), type, title, due_date (date),
remind_days, notify_user_ids, notified_state, note, last_renewed_at.

## API
- `GET /api/renewals`; `POST /api/renewals` `{ type, title, dueDate, remindDays?, vehicleId?, notifyUserIds?, note? }`
- `PATCH /api/renewals/{id}`; `DELETE /api/renewals/{id}`
- `POST /api/renewals/{id}/renew` `{ dueDate }` (must be later than the current one)

Writes are same-origin and audited (`renewal.created|updated|renewed|deleted`). The vehicle
and the recipients must belong to the caller's organization (400 otherwise); a renewal of
another organization is a 404.
