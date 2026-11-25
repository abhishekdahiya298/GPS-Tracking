import { Activity, AlertTriangle, Boxes, Building2, CheckCircle2, CircleOff, Cpu, Database, Plus, Radio, ReceiptText, Server, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { IconTitle } from "@/components/app/icon-title";
import { LocalDate, RelativeTime } from "@/components/app/local-time";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { hideDemoAccounts } from "@/lib/demo-pref";
import { getServerEnv } from "@/lib/env";
import { HideDemoToggle } from "./_shared/hide-demo-toggle";
import { ingestSnapshot } from "@/lib/ingest-stats";
import { getLiveHub } from "@/lib/live-hub";
import { Tile } from "@/app/(app)/dashboard/parts";
import { money } from "@/lib/plan-format";
import { periodOf, usageStatement } from "@/lib/plans";
import { getPlatformOverview, listActivity, type AttentionItem } from "@/lib/platform";
import { actionLabel } from "@/lib/platform-labels";
import { getReadyRedisPublisher } from "@/lib/redis";
import { getRequestContext } from "@/lib/request-context";
import { getDb } from "@rio-gps/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform · RIO GPS" };

async function timed<T>(fn: () => Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([fn(), new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

export default async function PlatformOverviewPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login?next=/admin");
  if (!rc.user.isSuperAdmin) redirect("/dashboard");
  const env = getServerEnv();
  const now = new Date();
  const hideDemo = await hideDemoAccounts();

  const [o, activity, redisOk, lastPosition, revenue] = await Promise.all([
    getPlatformOverview(env.GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS, now, hideDemo),
    listActivity({ page: 1, pageSize: 25, search: "", kind: "all", who: "platform" }),
    timed(async () => (await (await getReadyRedisPublisher()).ping()) === "PONG", 2000),
    timed(async () => {
      const [r] = await getDb().execute<{ at: Date | null }>(sql`select max(received_at) as at from location_history where received_at > now() - interval '1 day'`);
      return r?.at ? new Date(r.at).toISOString() : null;
    }, 3000),
    usageStatement(periodOf(now, "UTC"), undefined, now).catch(() => [])
  ]);
  // Sign-ins are noise here; they stay in the activity log.
  const recentActivity = activity.items.filter((a) => !a.action.startsWith("auth.")).slice(0, 8);
  const ingest = ingestSnapshot();
  const live = getLiveHub().stats();
  const firstName = (rc.user.name || "").split(" ")[0];
  const onlinePct = o.trackers.total ? Math.round((o.trackers.online / o.trackers.total) * 100) : 0;
  const silent = o.trackers.silent24h + o.trackers.never;
  const simIssues = o.inventory.simsActiveUnused + o.inventory.simsDeployedNotActive;
  const revenueCents = revenue.filter((l) => l.billed).reduce((t, l) => t + l.amounts.totalCents, 0);
  const positionsFresh = lastPosition ? now.getTime() - new Date(lastPosition).getTime() < 15 * 60_000 : false;

  return (
    <>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[linear-gradient(150deg,#2456d6,#0a2463)] text-white shadow-card">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-2xl font-semibold tracking-tight text-[#0a2463] dark:text-foreground">{firstName ? `Hello, ${firstName}` : "Platform overview"}</h1>
            <p className="m-0 mt-0.5 text-sm text-muted-foreground">
              {o.customers.active} active customer{o.customers.active === 1 ? "" : "s"} · {o.trackers.online} of {o.trackers.total} trackers online
              {o.attention.length > 0 ? ` · ${o.attention.length} need${o.attention.length === 1 ? "s" : ""} a look` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HideDemoToggle hidden={hideDemo} />
          <Link href="/admin/customers?new=1" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline shadow-card hover:bg-primary/90">
            <Plus className="size-4" aria-hidden="true" /> New customer
          </Link>
        </div>
      </header>

      <section aria-label="Platform summary" className="stagger-in mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile href="/admin/customers" icon={Building2} look="total" label="Customers" value={o.customers.active} hint={`${o.customers.newLast30} new in 30 days${o.customers.suspended ? ` · ${o.customers.suspended} suspended` : ""}`} />
        <Tile href="/admin/trackers?state=online" icon={Radio} look="moving" label="Trackers online" value={o.trackers.online} total={o.trackers.total} totalNoun="trackers" />
        <Tile href="/admin/trackers?state=silent" icon={CircleOff} look={silent > 0 ? "idle" : "offline"} label="Silent 24 h+" value={silent} hint={o.trackers.never ? `${o.trackers.never} never reported` : silent ? "Not heard from" : "All reporting"} />
        <Tile href="/admin/customers?sort=members&direction=desc" icon={Users} look="teal" label="Customer users" value={o.users.total} hint={`${o.users.signedInLast7} signed in this week`} />
        <Tile href="/admin/billing" icon={ReceiptText} look="purple" label="This month (est.)" value={money(revenueCents)} hint="Usage & billing" className="col-span-2 md:col-span-1" />
      </section>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <IconTitle icon={AlertTriangle}>Needs attention</IconTitle>
            <Link href="/admin/customers" className="text-sm font-medium text-primary no-underline hover:underline">
              All customers
            </Link>
          </CardHeader>
          {o.attention.length === 0 ? (
            <CardContent className="flex flex-col items-center py-10 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-success-soft text-success">
                <CheckCircle2 className="size-6" aria-hidden="true" />
              </span>
              <p className="m-0 mt-3 font-semibold text-[#0a2463] dark:text-foreground">Every customer looks healthy</p>
              <p className="m-0 mt-1 max-w-xs text-sm text-muted-foreground">Silent trackers, customers without trackers and customers nobody uses show up here.</p>
            </CardContent>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-3 pt-0">
              {o.attention.slice(0, 6).map((a) => {
                const look = ATTENTION[a.issue];
                return (
                  <li key={a.id} className="relative flex min-h-[60px] items-center gap-3 overflow-hidden rounded-xl border py-2.5 pl-4 pr-3" style={{ borderColor: `${look.color}30`, background: `linear-gradient(110deg, transparent 38%, ${look.color}12)` }}>
                    <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-1 rounded-r" style={{ background: look.color }} />
                    <span className="grid size-9 shrink-0 place-items-center rounded-[11px] text-white" style={{ background: `linear-gradient(150deg, ${look.color}cc, ${look.color})` }}>
                      <look.Icon className="size-4" aria-hidden="true" />
                    </span>
                    <Link href={`/admin/customers/${a.id}`} className="min-w-0 flex-1 text-foreground no-underline hover:underline">
                      <span className="block truncate text-[13px] font-semibold">{a.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <b style={{ color: look.color }}>{look.tag}</b> · {a.detail}
                      </span>
                    </Link>
                    <Link href={`/admin/customers/${a.id}${look.hash}`} className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-background px-3 text-[13px] font-semibold text-foreground no-underline hover:border-primary/40">
                      {look.action}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <IconTitle icon={Server}>System health</IconTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pt-0">
            <Health label="Database" ok value="Connected" icon={Database} />
            <Health label="Live updates" ok={redisOk === true} value={redisOk ? "Connected" : "Not reachable"} icon={Activity} />
            <Health label="GPS server" ok={positionsFresh} warn={!positionsFresh} value={lastPosition ? <>Last position <RelativeTime iso={lastPosition} /></> : "None in 24 h"} icon={Radio} />
            <Health label="Live map viewers" ok value={`${live.listeners} open now`} icon={Users} />
            {Object.keys(ingest.totals).length > 0 && (
              <p className="m-0 mt-1 text-xs text-muted-foreground">
                Since this server started (<RelativeTime iso={ingest.since} />): {ingest.totals.stored ?? 0} positions stored
                {ingest.totals.unknown_device ? `, ${ingest.totals.unknown_device} from unregistered trackers` : ""}
                {ingest.totals.store_failed ? `, ${ingest.totals.store_failed} failed` : ""}.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <IconTitle icon={Boxes}>Inventory</IconTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2.5 pt-0">
            <MiniStat href="/admin/trackers?state=stock" label="Trackers in stock" value={o.inventory.inStock} color="#0369a1" />
            <MiniStat
              href={simIssues > 0 ? "/admin/sims?view=attention" : "/admin/trackers?state=nosim"}
              label={simIssues > 0 ? "SIMs to fix" : "Without SIM"}
              value={simIssues > 0 ? simIssues : o.inventory.deployedNoSim}
              color="#b91c1c"
            />
            <MiniStat href="/admin/leads" label="New leads" value={o.newLeads} color="#6d28d9" />
            <MiniStat label="Loads in progress" value={o.loadsActive} color="#15803d" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <IconTitle icon={Building2}>Newest customers</IconTitle>
            <Link href="/admin/customers?sort=created&direction=desc" className="text-sm font-medium text-primary no-underline hover:underline">
              View all
            </Link>
          </CardHeader>
          {o.recentCustomers.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">No customers yet.</CardContent>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {o.recentCustomers.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/customers/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-foreground no-underline hover:bg-primary-soft/40 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        Added <LocalDate iso={c.createdAt} /> · {c.trackers} tracker{c.trackers === 1 ? "" : "s"}
                      </span>
                    </span>
                    {c.status === "suspended" && <StatusBadge tone="warning" label="Suspended" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <IconTitle icon={Activity}>Recent platform activity</IconTitle>
            <Link href="/admin/activity" className="text-sm font-medium text-primary no-underline hover:underline">
              Activity log
            </Link>
          </CardHeader>
          {recentActivity.length === 0 ? (
            <CardContent className="text-sm text-muted-foreground">Nothing yet. Customer, tracker and access changes made by platform admins appear here.</CardContent>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {recentActivity.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        <strong className="font-medium">{actionLabel(a.action)}</strong>
                        {a.customerName && (
                          <>
                            {" · "}
                            {a.customerId ? (
                              <Link href={`/admin/customers/${a.customerId}`} className="text-foreground no-underline hover:underline">
                                {a.customerName}
                              </Link>
                            ) : (
                              a.customerName
                            )}
                          </>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{a.actorName ?? "System"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <RelativeTime iso={a.at} />
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

const ATTENTION: Record<AttentionItem["issue"], { color: string; tag: string; action: string; hash: string; Icon: typeof Cpu }> = {
  no_trackers: { color: "#1d4ed8", tag: "Setup", action: "Add tracker", hash: "#trackers", Icon: Cpu },
  all_silent: { color: "#c2410c", tag: "Trackers", action: "Review", hash: "#trackers", Icon: CircleOff },
  some_silent: { color: "#c2410c", tag: "Trackers", action: "Review", hash: "#trackers", Icon: CircleOff },
  never_signed_in: { color: "#7c3aed", tag: "Users", action: "Resend invite", hash: "#users", Icon: Users },
  inactive_users: { color: "#7c3aed", tag: "Users", action: "Review", hash: "#users", Icon: Users },
  suspended: { color: "#b91c1c", tag: "Account", action: "Review", hash: "", Icon: AlertTriangle }
};

function MiniStat({ href, label, value, color }: { href?: string; label: string; value: number; color: string }) {
  const body = (
    <>
      <span className="block text-xs font-medium leading-4 text-muted-foreground">{label}</span>
      <span className="mt-1 block text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </span>
    </>
  );
  const cls = "block rounded-xl border border-border bg-background p-3 text-foreground no-underline";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-primary/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Health({ label, ok, warn, value, icon: Icon }: { label: string; ok: boolean; warn?: boolean; value: ReactNode; icon: typeof Cpu }) {
  const color = ok ? "#15803d" : warn ? "#b45309" : "#b91c1c";
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-xl border py-2 pl-4 pr-3" style={{ borderColor: `${color}30`, background: `linear-gradient(110deg, transparent 38%, ${color}12)` }}>
      <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-r" style={{ background: color }} />
      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] text-white" style={{ background: color }}>
        {ok ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{value}</span>
      </span>
    </div>
  );
}
