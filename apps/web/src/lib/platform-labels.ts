/** Plain-language labels for the actions the platform console shows most. */
export const ACTION_LABEL: Record<string, string> = {
  "customer.created": "Created customer",
  "customer.suspended": "Suspended customer",
  "customer.archived": "Archived customer",
  "customer.restored": "Restored customer",
  "device.registered": "Registered tracker",
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
