"use client";
import {
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  Cpu,
  FileBarChart,
  Hexagon,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Package,
  Settings,
  Truck,
  UserCircle,
  Users,
  Wrench,
  Activity,
  ShieldCheck,
  CardSim,
  ReceiptText,
  type LucideIcon,
  Inbox,
  ChevronRight,
  Home,
  Target,
  Layers
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { BrandMark } from "./brand-mark";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Sheet, SheetContent } from "../ui/dialog";
import { toast } from "../ui/toaster";
import { CommandPalette } from "./command-palette";
import { isActive, type NavIcon, type NavSection } from "./nav-config";
import { NAV_THEME_CLASSES, navTheme as toNavTheme, type NavTheme } from "./nav-themes";
import { TimeProvider } from "./time-context";
import { UnitsProvider } from "./units-context";
import type { TimeFormat, UnitSystem } from "@rio-gps/core";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  map: MapIcon,
  truck: Truck,
  package: Package,
  cpu: Cpu,
  zones: Hexagon,
  bell: Bell,
  reports: FileBarChart,
  wrench: Wrench,
  users: Users,
  building: Building2,
  settings: Settings,
  inbox: Inbox,
  activity: Activity,
  shield: ShieldCheck,
  user: UserCircle,
  sim: CardSim,
  receipt: ReceiptText,
  home: Home,
  target: Target,
  layers: Layers
};

/** Routes whose page fills the content area edge to edge (maps). */
const FULL_BLEED = ["/map", "/geofences", "/zones", "/loads/map"];

export interface ShellUser {
  name: string;
  email: string;
  roleLabel: string;
  isSuperAdmin: boolean;
}

/** A company the signed-in person belongs to (for the switcher). */
export interface ShellOrganization {
  id: string;
  name: string;
  roleLabel: string;
  current: boolean;
}

/**
 * "tenant": one company's app (for a platform admin, while viewing that customer).
 * "platform": the platform console; `viewAsName` is the customer still selected in this session.
 */
export type ShellMode = { kind: "tenant"; orgStatus?: "active" | "suspended" | "archived" } | { kind: "platform"; viewAsName: string | null };

export function AppShell({
  mode = { kind: "tenant" },
  nav,
  user,
  orgName,
  organizations,
  viewingAs,
  unackAlerts,
  canSeeAlerts,
  unitSystem,
  timeZone,
  timeFormat,
  navTheme,
  children
}: {
  mode?: ShellMode;
  nav: NavSection[];
  user: ShellUser;
  orgName: string;
  organizations: ShellOrganization[];
  viewingAs: boolean;
  unackAlerts: number;
  canSeeAlerts: boolean;
  unitSystem: UnitSystem;
  timeZone: string;
  timeFormat: TimeFormat;
  /** The person's menu style (My account); null = default. */
  navTheme?: string | null;
  children: ReactNode;
}) {
  const theme = toNavTheme(navTheme);
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  const fullBleed = FULL_BLEED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const home = mode.kind === "platform" ? "/admin" : "/dashboard";

  return (
    <TimeProvider timeZone={timeZone} timeFormat={timeFormat}>
    <div className="flex min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col lg:flex" aria-label="Main navigation">
        <SidebarContent nav={nav} pathname={pathname} orgName={orgName} user={user} home={home} theme={theme} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" title="RIO GPS" className="w-[18rem] p-0 lg:hidden">
          <SidebarContent nav={nav} pathname={pathname} orgName={orgName} user={user} home={home} hideBrand theme={theme} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu aria-hidden="true" />
          </Button>
          <Link href={home} className="flex items-center gap-2 text-[15px] font-semibold text-foreground no-underline lg:hidden">
            <Brand />
          </Link>
          <div className="hidden min-w-0 flex-1 items-center gap-2 truncate text-sm text-muted-foreground lg:flex">
            {mode.kind === "platform" && <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />}
            <span className="truncate">{orgName}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <CommandPalette nav={nav} />
            {canSeeAlerts && (
              <Button asChild variant="ghost" size="icon" className="relative">
                <Link href="/alerts" aria-label={unackAlerts > 0 ? `Alerts, ${unackAlerts} unacknowledged` : "Alerts"}>
                  <Bell aria-hidden="true" />
                  {unackAlerts > 0 && (
                    <span aria-hidden="true" className="absolute right-1 top-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">
                      {unackAlerts > 99 ? "99+" : unackAlerts}
                    </span>
                  )}
                </Link>
              </Button>
            )}
            <UserMenu user={user} orgName={orgName} organizations={organizations} viewingAs={viewingAs} platform={mode.kind === "platform"} />
          </div>
        </header>

        {viewingAs && mode.kind === "tenant" && <ViewAsBanner orgName={orgName} orgStatus={mode.orgStatus ?? "active"} />}
        {mode.kind === "platform" && mode.viewAsName && <StillViewingBanner name={mode.viewAsName} />}

        <main id="main" className={cn("flex-1", fullBleed && "relative h-[calc(100dvh-3.5rem)] overflow-hidden")}>
          <UnitsProvider system={unitSystem}>{fullBleed ? children : <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>}</UnitsProvider>
        </main>
      </div>
    </div>
    </TimeProvider>
  );
}

function Brand({ large }: { large?: boolean }) {
  return <BrandMark className={large ? "h-[58px]" : "h-9"} />;
}

/** Bottom decoration per style: the logo's stripes, a soft wave, or a night road with light trails. */
function SidebarDecor({ theme }: { theme: NavTheme }) {
  if (theme === "light")
    return (
      <svg aria-hidden="true" viewBox="0 0 240 120" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full">
        <path d="M0 60 C 60 30, 120 90, 240 40 L240 120 L0 120 Z" fill="#dbe7fb" opacity="0.7" />
        <path d="M0 85 C 70 60, 150 110, 240 70 L240 120 L0 120 Z" fill="#c7d9f7" opacity="0.6" />
      </svg>
    );
  if (theme === "glass")
    return (
      <svg aria-hidden="true" viewBox="0 0 240 160" preserveAspectRatio="xMidYMax slice" className="pointer-events-none absolute inset-x-0 bottom-0 h-72 w-full">
        <defs>
          <linearGradient id="nav-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#0c1426" stopOpacity="0" />
            <stop offset="1" stopColor="#1b2a4a" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="nav-trail" x1="0" x2="1">
            <stop offset="0" stopColor="#ff6a3d" stopOpacity="0" />
            <stop offset="0.6" stopColor="#ff8a3d" />
            <stop offset="1" stopColor="#ffd08a" />
          </linearGradient>
        </defs>
        <rect width="240" height="160" fill="url(#nav-sky)" />
        <path d="M0 95 L40 70 L70 85 L110 55 L150 80 L190 60 L240 85 L240 160 L0 160 Z" fill="#0a1222" />
        <path d="M0 150 C 80 140, 160 120, 240 96" stroke="url(#nav-trail)" strokeWidth="2.2" fill="none" />
        <path d="M0 157 C 90 148, 170 128, 240 104" stroke="#ff3b47" strokeOpacity="0.7" strokeWidth="1.4" fill="none" />
        <path d="M0 160 C 100 155, 180 138, 240 114" stroke="#ffe2b0" strokeOpacity="0.5" strokeWidth="1" fill="none" />
      </svg>
    );
  return (
    <svg aria-hidden="true" viewBox="0 0 240 300" preserveAspectRatio="xMaxYMax slice" className="pointer-events-none absolute bottom-0 right-0 h-72 w-full">
      <path d="M70 300 190 60h26L96 300z" fill="#ffffff" opacity="0.05" />
      <path d="M118 300 238 60h12L130 300z" fill="#d81e2c" opacity="0.55" />
      <path d="M150 300 270 60h26L176 300z" fill="#ffffff" opacity="0.05" />
    </svg>
  );
}

/**
 * The menu: brand card, a standalone home item, then each section as one rounded group with
 * a row per page (icon tile, label, chevron). The current page is highlighted with an accent
 * bar. Same component for the customer app and the platform console; `theme` (My account →
 * Menu style) only changes colours and surfaces.
 */
function SidebarContent({ nav, pathname, orgName, user, home, hideBrand, theme }: { nav: NavSection[]; pathname: string; orgName: string; user: ShellUser; home: string; hideBrand?: boolean; theme: NavTheme }) {
  const t = NAV_THEME_CLASSES[theme];
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div data-nav-theme={theme} className={cn("relative flex h-full min-h-0 flex-col overflow-hidden", t.root)}>
      <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 top-0 h-64 [background-size:10px_10px] [mask-image:linear-gradient(180deg,#000,transparent)]", t.dots)} />
      <SidebarDecor theme={theme} />
      {!hideBrand && (
        <div className="relative shrink-0 px-3.5 pb-2 pt-3.5">
          <Link href={home} aria-label="RIO GPS home" className={cn("group relative block overflow-hidden rounded-2xl no-underline", t.brandOuter, t.focus)}>
            <span className={cn("relative flex h-[76px] items-center justify-center overflow-hidden rounded-[14px] px-3", t.brandInner)}>
              {theme === "gradient" && (
                <svg aria-hidden="true" viewBox="0 0 200 80" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  <path d="M150 80 C 178 78, 194 66, 200 46 L200 80 Z" fill="#d81e2c" />
                  <path d="M158 80 C 182 76, 196 63, 200 52 L200 56 C 195 68, 183 78, 166 80 Z" fill="#ffffff" opacity="0.9" />
                  <path d="M0 0 L42 0 C 22 3, 8 10, 0 22 Z" fill="#0a2463" opacity="0.12" />
                </svg>
              )}
              <span className="relative transition-transform duration-200 group-hover:scale-[1.03]">
                <Brand large />
              </span>
            </span>
          </Link>
        </div>
      )}
      <nav className="relative min-h-0 flex-1 overflow-y-auto px-3.5 py-3 [scrollbar-color:rgb(127_127_127/0.35)_transparent]" aria-label="Primary">
        {nav.map((section, si) => (
          <div key={section.title ?? si} className={cn(si > 0 && "mt-4")}>
            {section.title && <p className={cn("m-0 mb-2 px-1.5 text-[11px] font-semibold uppercase tracking-[0.09em]", t.sectionTitle)}>{section.title}</p>}
            {/* Titled sections are one group; a lone item (home) stands on its own. */}
            <ul className={cn("m-0 list-none p-0", section.title && cn("overflow-hidden rounded-xl p-1", t.group))}>
              {section.items.map((item, ii) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item);
                return (
                  <li key={item.href} className={cn(section.title && ii > 0 && cn("border-t", t.divider))}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-2 text-[14px] no-underline transition-all duration-150",
                        t.focus,
                        section.title ? "h-11 border border-transparent" : cn("h-12", t.lone),
                        active ? t.active : t.idle
                      )}
                    >
                      {active && <span aria-hidden="true" className={cn("absolute inset-y-1.5 left-0 w-1 rounded-r-full", t.accent)} />}
                      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg transition-colors", active ? t.tileActive : t.tileIdle)}>
                        <Icon className="size-[17px] transition-transform duration-200 group-hover:scale-110" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {section.title && <ChevronRight className={cn("size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5", active ? t.chevronActive : t.chevronIdle)} aria-hidden="true" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cn("relative m-3.5 flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 backdrop-blur", t.footer)}>
        <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ring-2", t.avatar)}>
          {initials || "?"}
        </span>
        <div className="min-w-0">
          <p className={cn("m-0 truncate text-sm font-semibold", t.footerTitle)}>{orgName}</p>
          <p className={cn("m-0 truncate text-xs", t.footerSub)}>
            {user.name} · {user.roleLabel}
          </p>
        </div>
      </div>
    </div>
  );
}

function UserMenu({ user, orgName, organizations, viewingAs, platform }: { user: ShellUser; orgName: string; organizations: ShellOrganization[]; viewingAs: boolean; platform: boolean }) {
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex h-9 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-1.5 text-left hover:bg-muted" aria-label={`Account menu for ${user.name}`}>
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
            {initials || "?"}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium text-foreground sm:block">{user.name}</span>
          <ChevronsUpDown className="hidden size-3.5 text-muted-foreground sm:block" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
          <span className="block truncate">{user.email}</span>
          <span className="mt-1 block truncate">
            {orgName} · {user.roleLabel}
          </span>
        </DropdownMenuLabel>
        {organizations.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="pb-0.5 text-xs font-medium">Switch company</DropdownMenuLabel>
            {organizations.map((o) => (
              <DropdownMenuItem key={o.id} onSelect={() => void switchCompany(o.id)} aria-current={o.current && !viewingAs ? "true" : undefined}>
                {o.current && !viewingAs ? <Check aria-hidden="true" /> : <Building2 aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{o.roleLabel}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <UserCircle aria-hidden="true" /> My account
          </Link>
        </DropdownMenuItem>
        {user.isSuperAdmin && !platform && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck aria-hidden="true" /> Platform console
            </Link>
          </DropdownMenuItem>
        )}
        {viewingAs && <DropdownMenuItem onSelect={() => void exitViewAs()}>Exit customer view</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            // Loaded on demand: keeps the auth client out of every page's initial bundle.
            const { authClient } = await import("@/lib/client/auth-client");
            await authClient.signOut();
            window.location.assign("/login");
          }}
        >
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function switchCompany(organizationId: string) {
  try {
    await api("/api/account/organization", { method: "POST", json: { organizationId } });
    // A full load, so every page, list and live stream starts again in the other company.
    window.location.assign("/dashboard");
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

async function exitViewAs() {
  try {
    await api("/api/admin/view-as", { method: "POST", json: { organizationId: null } });
    window.location.assign("/admin");
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

const STATUS_NOTE: Record<"suspended" | "archived", string> = {
  suspended: "This customer is suspended: its users can't sign in and no alerts go out.",
  archived: "This customer is archived: its users can't sign in and tracker positions aren't stored."
};

function ViewAsBanner({ orgName, orgStatus }: { orgName: string; orgStatus: "active" | "suspended" | "archived" }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-sm text-foreground">
      <span>
        Viewing as customer <strong>{orgName}</strong>. You have full access here and every action is audited.
        {orgStatus !== "active" && <strong className="ml-1 text-danger">{STATUS_NOTE[orgStatus]}</strong>}
      </span>
      <span className="flex gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin">Platform console</Link>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void exitViewAs()}>
          Exit customer view
        </Button>
      </span>
    </div>
  );
}

/** In the platform console while a customer is still selected for this session. */
function StillViewingBanner({ name }: { name: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-muted px-4 py-2 text-center text-sm text-foreground">
      <span>
        Customer view is still open for <strong>{name}</strong>.
      </span>
      <span className="flex gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href="/dashboard">Back to {name}</Link>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void exitViewAs()}>
          Exit customer view
        </Button>
      </span>
    </div>
  );
}
