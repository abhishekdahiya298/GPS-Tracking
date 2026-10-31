/** Plain-language labels for the actions the platform console shows most. */
export const ACTION_LABEL: Record<string, string> = {
  "customer.created": "Created customer",
  "customer.suspended": "Suspended customer",
  "customer.archived": "Archived customer",
  "customer.restored": "Restored customer",
  "device.registered": "Registered tracker",
  "device.stocked": "Added tracker to stock",
  "device.assigned_to_customer": "Assigned tracker",
  "device.moved_out": "Moved tracker out",
  "device.moved_in": "Moved tracker in",
  "device.returned_to_stock": "Returned tracker to stock",
  "device.returned_retired": "Returned and retired tracker",
  "device.retired": "Retired tracker",
  "device.unretired": "Put tracker back in stock",
  "device.inventory_updated": "Edited tracker details",
  "sim.added": "Added SIM",
  "sim.updated": "Edited SIM",
  "sim.activated": "Activated SIM",
  "sim.suspended": "Suspended SIM",
  "sim.cancelled": "Cancelled SIM",
  "sim.inventory": "Marked SIM not activated",
  "sim.linked": "Put SIM in tracker",
  "sim.unlinked": "Took SIM out of tracker",
  "customer.updated": "Edited customer",
  "member.renamed": "Renamed user",
  "member.password_reset": "Reset user's password",
  "member.two_step_reset": "Turned off user's two-step",
  "user.name_changed": "Changed own name",
  "device.bulk_imported": "Imported trackers",
  "admin.view_as_started": "Opened customer view",
  "admin.view_as_ended": "Left customer view",
  "member.added": "Added user",
  "member.removed": "Removed user",
  "member.role_changed": "Changed user role",
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.logout": "Signed out",
  "auth.organization_switched": "Switched company"
};

/** "vehicle_group.updated" → "Vehicle group updated" for actions without their own label. */
export function actionLabel(action: string): string {
  const known = ACTION_LABEL[action];
  if (known) return known;
  const words = action.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
