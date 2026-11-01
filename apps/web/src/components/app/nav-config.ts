import { contextHasPermission, type Permission, type TenantContext } from "@rio-gps/core";

/**
 * Single source of truth for the application menu. Items are filtered on the
 * server with the same permission checks the pages and APIs enforce: hiding a
 * link is a convenience, never the security boundary.
 */
export type NavIcon = "dashboard" | "map" | "truck" | "package" | "cpu" | "zones" | "bell" | "reports" | "wrench" | "users" | "building" | "settings" | "inbox" | "activity" | "shield" | "user" | "sim" | "receipt";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
  /** Highlight on this exact path only (an overview whose sub-pages have their own items). */
  exact?: boolean;
}
export interface NavSection {
  title?: string;
  items: NavItem[];
}

type Rule = NavItem & { permission?: Permission; superAdminOnly?: boolean };

const SECTIONS: { title?: string; items: Rule[] }[] = [
  // Fleet overview; a Loads-only plan starts at Loads instead.
  { items: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "locations.read" }] },
  {
    title: "Tracking",
    items: [
      { href: "/map", label: "Live tracking", icon: "map", permission: "locations.read" },
      { href: "/loads", label: "Loads", icon: "package", permission: "loads.read" },
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
      { href: "/settings/plan", label: "Plan & usage", icon: "receipt", permission: "billing.read" },
      { href: "/settings/organization", label: "Settings", icon: "settings", permission: "organization.manage" }
    ]
  }
];

/**
 * Platform admins see one more section while viewing a customer, leading back to the console.
 * Customer pages never list platform pages, so a customer's menu looks the same for them.
 */
const PLATFORM_LINK: Rule = { href: "/admin", label: "Platform console", icon: "shield", superAdminOnly: true };

/** The platform console (platform admins only; every page and API re-checks). */
export const PLATFORM_NAV: NavSection[] = [
  { items: [{ href: "/admin", label: "Overview", icon: "dashboard", exact: true }] },
  {
    title: "Customers",
    items: [
      { href: "/admin/customers", label: "Customers", icon: "building" },
      { href: "/admin/leads", label: "Leads", icon: "inbox" }
    ]
  },
  {
    title: "Inventory",
    items: [
      { href: "/admin/trackers", label: "Trackers", icon: "cpu" },
      { href: "/admin/sims", label: "SIM cards", icon: "sim" }
    ]
  },
  {
    title: "Billing",
    items: [
      { href: "/admin/billing", label: "Usage & billing", icon: "receipt" },
      { href: "/admin/plans", label: "Plans", icon: "package" }
    ]
  },
  {
    title: "Platform",
    items: [
      { href: "/admin/activity", label: "Activity log", icon: "activity" },
      { href: "/settings/account", label: "My account", icon: "user" }
    ]
  }
];

export function buildNav(ctx: TenantContext): NavSection[] {
  const sections = ctx.isSuperAdmin ? [...SECTIONS, { title: "Platform", items: [PLATFORM_LINK] }] : SECTIONS;
  return sections.map((s) => ({
    title: s.title,
    items: s.items
      .filter((i) => (i.superAdminOnly ? ctx.isSuperAdmin : !i.permission || contextHasPermission(ctx, i.permission)))
      .map(({ href, label, icon, match, exact }) => ({ href, label, icon, ...(match ? { match } : {}), ...(exact ? { exact } : {}) }))
  })).filter((s) => s.items.length > 0);
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
