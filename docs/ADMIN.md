# Platform admin: customer onboarding

Only users with `users.is_super_admin = true` can use this. Org roles (even ORG_ADMIN) get 403.

## /admin/customers

- **New customer**: creates the organization, its Traccar provider row, and the first **Org Admin**.
  If Resend is configured the admin is emailed a 72 h set-password link; otherwise a one-time
  password is shown once on screen (never logged).
- **Register a device**: validates the IMEI (15 digits + Luhn check), creates the device in
  Traccar through its REST API (`TRACCAR_API_URL/USER/PASSWORD`; reuses an existing Traccar
  device with that IMEI), then records it in RIO for that customer. If Traccar fails nothing is
  saved (502). An IMEI can belong to only one customer (409).
  Then point the tracker at `tracker.riocaliforniainc.com:5027` and assign it to a vehicle.
- **Bulk import**: paste a column of IMEIs (optionally `IMEI, name` per line; a header line and
  spaces/dashes in numbers are fine). The browser previews what will be skipped (not 15 digits,
  fails the check digit, listed twice); the server re-checks every row and registers them one at a
  time through the same path as a single registration, up to 200 per import. A failed row never
  stops the others; the result lists each IMEI that needs attention (already registered to another
  customer, invalid, Traccar failure). Rows already registered for this customer are left as they
  are. Audited as `device.bulk_imported` with the counts, plus one `device.registered` per tracker.
  Then add the same IMEIs to the FOTA WEB group so each tracker gets its settings on first power-on.
- **View as**: sets the admin's session to act inside that customer (role shown as SUPER_ADMIN,
  full permissions). A yellow banner on the dashboard shows it with an **Exit** button.

API: `GET/POST /api/admin/customers`, `POST /api/admin/customers/{id}/devices`,
`POST /api/admin/customers/{id}/devices/bulk { model, rows: [{ imei, name? }] }`,
`POST /api/admin/view-as { organizationId | null }`. All writes are same-origin only and audited
(`customer.created`, `member.added`, `device.registered` (IMEI last 4 only),
`admin.view_as_started` / `admin.view_as_ended`).

Tenant isolation: only super admins can act in an organization they are not a member of;
for everyone else a session's `activeOrganizationId` is honoured only if they hold a
membership there (tests: `tests/integration/admin.itest.ts`, `auth-tenancy.itest.ts`).
