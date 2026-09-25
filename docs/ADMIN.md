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
- **View as**: sets the admin's session to act inside that customer (role shown as SUPER_ADMIN,
  full permissions). A yellow banner on the dashboard shows it with an **Exit** button.

API: `GET/POST /api/admin/customers`, `POST /api/admin/customers/{id}/devices`,
`POST /api/admin/view-as { organizationId | null }`. All writes are same-origin only and audited
(`customer.created`, `member.added`, `device.registered` (IMEI last 4 only),
`admin.view_as_started` / `admin.view_as_ended`).

Tenant isolation: only super admins can act in an organization they are not a member of;
for everyone else a session's `activeOrganizationId` is honoured only if they hold a
membership there (tests: `tests/integration/admin.itest.ts`, `auth-tenancy.itest.ts`).
