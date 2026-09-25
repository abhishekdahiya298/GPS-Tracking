import { contextHasPermission, type Permission, type TenantContext } from "@rio-gps/core";

/**
 * Single source of truth for the application menu. Items are filtered on the
 * server with the same permission checks the pages and APIs enforce: hiding a
 * link is a convenience, never the security boundary.
 */
export type NavIcon = "dashboard" | "map" | "truck" | "cpu" | "zones" | "bell" | "reports" | "wrench" | "users" | "building" | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
}
export interface NavSection {
  title?: string;
  items: NavItem[];
}

type Rule = NavItem & { permission?: Permission; superAdminOnly?: boolean };

const SECTIONS: { title?: string; items: Rule[] }[] = [
  { items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }] },
  {
    title: "Tracking",
    items: [
      { href: "/map", label: "Live tracking", icon: "map", permission: "locations.read" },
      { href: "/vehicles", label: "Vehicles", icon: "truck", permission: "vehicles.read" },
      { href: "/devices", label: "Devices", icon: "cpu", permission: "devices.read" }
    ]
  },
  {
    title: "Operations",
    items: [
      { href: "/geofences", label: "Zones", icon: "zones", permission: "geofences.read", match: ["/zones"] },
      { href: "/alerts", label: "Alerts", icon: "bell", permission: "alerts.read" },
      { href: "/reports", label: "Reports", icon: "reports", permission: "history.read" },
      { href: "/maintenance", label: "Maintenance", icon: "wrench", permission: "maintenance.read" }
    ]
  },
  {
    title: "Administration",
    items: [
      { href: "/settings/team", label: "Team", icon: "users", permission: "users.read" },
      { href: "/admin/customers", label: "Customers", icon: "building", superAdminOnly: true }
    ]
  }
];

export function buildNav(ctx: TenantContext): NavSection[] {
  return SECTIONS.map((s) => ({
    title: s.title,
    items: s.items
      .filter((i) => (i.superAdminOnly ? ctx.isSuperAdmin : !i.permission || contextHasPermission(ctx, i.permission)))
      .map(({ href, label, icon, match }) => ({ href, label, icon, ...(match ? { match } : {}) }))
  })).filter((s) => s.items.length > 0);
}

export function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
