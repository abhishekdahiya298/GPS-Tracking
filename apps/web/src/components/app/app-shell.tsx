"use client";
import {
  Bell,
  Building2,
  ChevronsUpDown,
  Cpu,
  FileBarChart,
  Hexagon,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Settings,
  Truck,
  UserCircle,
  Users,
  Wrench,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Sheet, SheetContent } from "../ui/dialog";
import { toast } from "../ui/toaster";
import { CommandPalette } from "./command-palette";
import { isActive, type NavIcon, type NavSection } from "./nav-config";
import { UnitsProvider } from "./units-context";
import type { UnitSystem } from "@rio-gps/core";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  map: MapIcon,
  truck: Truck,
  cpu: Cpu,
  zones: Hexagon,
  bell: Bell,
  reports: FileBarChart,
  wrench: Wrench,
  users: Users,
  building: Building2,
  settings: Settings
};

/** Routes whose page fills the content area edge to edge (maps). */
const FULL_BLEED = ["/map", "/geofences", "/zones"];

export interface ShellUser {
  name: string;
  email: string;
  roleLabel: string;
  isSuperAdmin: boolean;
}

export function AppShell({
  nav,
  user,
  orgName,
  viewingAs,
  unackAlerts,
  canSeeAlerts,
  unitSystem,
  children
}: {
  nav: NavSection[];
  user: ShellUser;
  orgName: string;
  viewingAs: boolean;
  unackAlerts: number;
  canSeeAlerts: boolean;
  unitSystem: UnitSystem;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);
  const fullBleed = FULL_BLEED.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <div className="flex min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-background lg:flex" aria-label="Main navigation">
        <SidebarContent nav={nav} pathname={pathname} orgName={orgName} user={user} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" title="RIO GPS" className="w-72 p-0 lg:hidden">
          <SidebarContent nav={nav} pathname={pathname} orgName={orgName} user={user} hideBrand />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu aria-hidden="true" />
          </Button>
          <Link href="/dashboard" className="flex items-center gap-2 text-[15px] font-semibold text-foreground no-underline lg:hidden">
            <Brand />
          </Link>
          <div className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground lg:block">{orgName}</div>
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
            <UserMenu user={user} orgName={orgName} viewingAs={viewingAs} />
          </div>
        </header>

        {viewingAs && <ViewAsBanner orgName={orgName} />}

        <main id="main" className={cn("flex-1", fullBleed && "relative h-[calc(100dvh-3.5rem)] overflow-hidden")}>
          <UnitsProvider system={unitSystem}>{fullBleed ? children : <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>}</UnitsProvider>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <>
      <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-white">
        R
      </span>
      <span>RIO GPS</span>
    </>
  );
}

function SidebarContent({ nav, pathname, orgName, user, hideBrand }: { nav: NavSection[]; pathname: string; orgName: string; user: ShellUser; hideBrand?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!hideBrand && (
        <Link href="/dashboard" className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 text-[15px] font-semibold text-foreground no-underline">
          <Brand />
        </Link>
      )}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label="Primary">
        {nav.map((section, si) => (
          <div key={section.title ?? si} className={cn(si > 0 && "mt-5")}>
            {section.title && <p className="m-0 mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>}
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
                        "flex h-9 items-center gap-2.5 rounded-md px-2 text-sm no-underline transition-colors",
                        active ? "bg-primary-soft font-medium text-primary" : "text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-border px-4 py-3">
        <p className="m-0 truncate text-sm font-medium text-foreground">{orgName}</p>
        <p className="m-0 truncate text-xs text-muted-foreground">
          {user.name} · {user.roleLabel}
        </p>
      </div>
    </div>
  );
}

function UserMenu({ user, orgName, viewingAs }: { user: ShellUser; orgName: string; viewingAs: boolean }) {
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
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <UserCircle aria-hidden="true" /> My account
          </Link>
        </DropdownMenuItem>
        {user.isSuperAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin/customers">
              <Building2 aria-hidden="true" /> Customers
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

async function exitViewAs() {
  try {
    await api("/api/admin/view-as", { method: "POST", json: { organizationId: null } });
    window.location.assign("/admin/customers");
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

function ViewAsBanner({ orgName }: { orgName: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-sm text-foreground">
      <span>
        Viewing as customer <strong>{orgName}</strong>. You have full access here and every action is audited.
      </span>
      <Button size="sm" variant="secondary" onClick={() => void exitViewAs()}>
        Exit customer view
      </Button>
    </div>
  );
}
