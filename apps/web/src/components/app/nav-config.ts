import { contextHasPermission, DEFAULT_FEATURE_RULES, type Feature, type FeatureRule, type Permission, type TenantContext } from "@rio-gps/core";

/**
 * Single source of truth for the application menu. Items are filtered on the
 * server with the same permission checks the pages and APIs enforce: hiding a
 * link is a convenience, never the security boundary.
 */
export type NavIcon = "dashboard" | "map" | "truck" | "package" | "cpu" | "zones" | "bell" | "reports" | "wrench" | "users" | "building" | "settings" | "inbox" | "activity" | "shield" | "user" | "sim" | "receipt" | "home" | "target" | "layers" | "smartphone" | "driver";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
  /** Highlight on this exact path only (an overview whose sub-pages have their own items). */
  exact?: boolean;
  /** Not in the customer's plan: shown with a lock, opens the lock page. */
  locked?: boolean;
}
export interface NavSection {
  title?: string;
  items: NavItem[];
}

type Rule = NavItem & { permission?: Permission; superAdminOnly?: boolean; feature?: Feature };

const SECTIONS: { title?: string; items: Rule[] }[] = [
  // The two pages people open every day stand on their own at the top.
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "home" },
      { href: "/map", label: "Live map", icon: "map", permission: "locations.read", feature: "live_map" }
    ]
  },
  {
    title: "Fleet",
    items: [
      { href: "/vehicles", label: "Vehicles", icon: "truck", permission: "vehicles.read" },
      { href: "/drivers", label: "Drivers", icon: "driver", permission: "vehicles.read" },
      { href: "/devices", label: "GPS devices", icon: "cpu", permission: "devices.read", feature: "gps_trackers" },
      { href: "/maintenance", label: "Maintenance", icon: "wrench", permission: "maintenance.read", feature: "maintenance" }
    ]
  },
  {
    title: "Operations",
    items: [
      { href: "/loads", label: "Loads", icon: "package", permission: "loads.read", feature: "loads" },
      { href: "/geofences", label: "Zones", icon: "zones", permission: "geofences.read", match: ["/zones"], feature: "zones" },
      { href: "/alerts", label: "Alerts", icon: "bell", permission: "alerts.read", feature: "alerts" },
      { href: "/reports", label: "Reports", icon: "reports", permission: "history.read", feature: "reports" }
    ]
  },
  {
    title: "Account",
    items: [
      { href: "/settings/team", label: "Team", icon: "users", permission: "users.read" },
      { href: "/settings/plan", label: "Plan & billing", icon: "receipt", permission: "billing.read" },
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
  { items: [{ href: "/admin", label: "Overview", icon: "home", exact: true }] },
  {
    title: "Customers",
    items: [
      { href: "/admin/customers", label: "Customers", icon: "users" },
      { href: "/admin/leads", label: "Leads", icon: "target" },
      { href: "/admin/drivers", label: "All drivers", icon: "driver" }
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
      { href: "/admin/plans", label: "Plans", icon: "layers" },
      { href: "/admin/signup", label: "Sign-up & upgrades", icon: "user" }
    ]
  },
  {
    title: "Platform",
    items: [
      { href: "/admin/app", label: "Mobile app", icon: "smartphone" },
      { href: "/admin/maps", label: "Maps & addresses", icon: "map" },
      { href: "/admin/settings", label: "Platform settings", icon: "settings" },
      { href: "/admin/activity", label: "Activity log", icon: "activity" },
      { href: "/settings/account", label: "My account", icon: "user" }
    ]
  }
];

/**
 * The menu for this person. An item whose feature isn't in the customer's plan is shown with a
 * lock (it opens the lock page) or left out, as the platform chose for that feature; the role
 * still has to allow it either way.
 */
export function buildNav(ctx: TenantContext, rules: Readonly<Record<Feature, FeatureRule>> = DEFAULT_FEATURE_RULES, opts: { loadsInMenu?: boolean } = {}): NavSection[] {
  const sections = ctx.isSuperAdmin ? [...SECTIONS, { title: "Platform", items: [PLATFORM_LINK] }] : SECTIONS;
  const unlocked: TenantContext = { ...ctx, lockedFeatures: [] };
  return sections
    .map((s) => ({
      title: s.title,
      items: s.items.flatMap(({ href, label, icon, match, exact, permission, superAdminOnly, feature }) => {
        if (superAdminOnly && !ctx.isSuperAdmin) return [];
        // Plans like RIO Fleet keep loads under Drivers (Drivers | Loads) instead of the menu.
        if (href === "/loads" && opts.loadsInMenu === false) return [];
        const isLocked = !!feature && !!ctx.lockedFeatures?.includes(feature);
        if (isLocked && rules[feature!] === "hide") return [];
        if (permission && !contextHasPermission(isLocked ? unlocked : ctx, permission)) return [];
        return [{ href, label, icon, ...(match ? { match } : {}), ...(exact ? { exact } : {}), ...(isLocked ? { locked: true } : {}) }];
      })
    }))
    .filter((s) => s.items.length > 0);
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
