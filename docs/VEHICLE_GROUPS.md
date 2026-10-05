# Vehicle groups

Named sets of vehicles inside one organization (for example by region, customer or vehicle
type). A vehicle can be in several groups. Groups only organize and filter; they don't
change permissions (everyone in the organization still sees every vehicle).

- **Manage**: Vehicles → **Groups** (permission `vehicles.update`: Org Admin, Fleet Manager).
  Create, rename, pick members, delete. Deleting a group never deletes vehicles.
- **Use**: filter the vehicle list (`/vehicles?group=<id>`), the live map (group picker in
  the side panel) and the Stops / Idling / Speeding / Mileage reports (the vehicle picker
  lists groups first).

## Data (migration 0009, additive)
- `vehicle_groups` (id, organization_id, name; unique per organization, case-insensitive).
- `vehicle_group_members` (group_id, vehicle_id, organization_id). Rows cascade when the
  group or the vehicle is deleted.

## API
- `GET /api/vehicle-groups` (`vehicles.read`): `{ groups: [{ id, name, vehicleIds }] }`.
- `POST /api/vehicle-groups` `{ name, vehicleIds? }`; `PATCH /api/vehicle-groups/{id}`
  `{ name?, vehicleIds? }` (the list replaces the members); `DELETE /api/vehicle-groups/{id}`.
  All writes: `vehicles.update`, same-origin, audited (`vehicle_group.created|updated|deleted`).
- `GET /api/vehicles?...&group=<id>` and `GET /api/reports/activity?...&groupId=<id>`.

## Tenant isolation
The organization always comes from the session. Vehicle ids sent by the browser are checked
against that organization and rejected (400) if any is foreign; a group id from another
organization is a 404 for writes and reports, and matches no rows in the vehicle list.
Limit: 200 groups per organization.
