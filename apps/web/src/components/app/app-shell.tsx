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
  type LucideIcon,
  Inbox
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
  user: UserCircle
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
  children: ReactNode;
}) {
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

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col lg:flex" aria-label="Main navigation">
        <SidebarContent nav={nav} pathname={pathname} orgName={orgName} user={user} home={home} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" title="RIO GPS" className="w-72 p-0 lg:hidden">
          <SidebarContent nav={nav} pathname={pathname} orgName={orgName} user={user} home={home} hideBrand />
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

function SidebarContent({ nav, pathname, orgName, user, home, hideBrand }: { nav: NavSection[]; pathname: string; orgName: string; user: ShellUser; home: string; hideBrand?: boolean }) {
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#0a2463_0%,#0b2a72_55%,#123a8f_100%)] text-white">
      {/* The logo's stripes, faint, behind the menu. */}
      <svg aria-hidden="true" viewBox="0 0 240 300" preserveAspectRatio="xMaxYMax slice" className="pointer-events-none absolute bottom-0 right-0 h-72 w-full">
        <path d="M70 300 190 60h26L96 300z" fill="#ffffff" opacity="0.05" />
        <path d="M118 300 238 60h12L130 300z" fill="#d81e2c" opacity="0.5" />
        <path d="M150 300 270 60h26L176 300z" fill="#ffffff" opacity="0.05" />
      </svg>
      {!hideBrand && (
        <div className="relative shrink-0 px-3 pb-2 pt-3">
          <Link href={home} aria-label="RIO GPS home" className="flex h-[74px] items-center justify-center rounded-xl bg-white px-3 no-underline shadow-card transition-transform duration-200 hover:scale-[1.02] focus-visible:outline-white">
            <Brand large />
          </Link>
        </div>
      )}
      <nav className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-color:rgb(255_255_255/0.3)_transparent]" aria-label="Primary">
        {nav.map((section, si) => (
          <div key={section.title ?? si} className={cn(si > 0 && "mt-5")}>
            {section.title && <p className="m-0 mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-white/60">{section.title}</p>}
            <ul className="m-0 list-none space-y-0.5 p-0">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm no-underline transition-colors focus-visible:outline-white",
                        active ? "bg-white font-semibold text-[#0a2463] shadow-card" : "text-white/85 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {active && <span aria-hidden="true" className="absolute -left-3 top-2 h-6 w-1 rounded-r-full bg-[#ff4b57]" />}
                      <Icon className={cn("size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110", active ? "text-[#d81e2c]" : "text-white/70 group-hover:text-white")} aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="relative m-3 flex shrink-0 items-center gap-2.5 rounded-lg bg-white/10 px-3 py-2.5 backdrop-blur">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-[#0a2463]">
          {initials || "?"}
        </span>
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-medium text-white">{orgName}</p>
          <p className="m-0 truncate text-xs text-white/70">
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
