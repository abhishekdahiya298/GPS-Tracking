import { Activity, AlertTriangle, ArrowRight, Building2, CheckCircle2, CircleOff, Cpu, Database, Inbox, Package, Plus, Radio, Server, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { IconTitle } from "@/components/app/icon-title";
import { LocalDate, RelativeTime } from "@/components/app/local-time";
import { StatusBadge } from "@/components/app/status-badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { getServerEnv } from "@/lib/env";
import { ingestSnapshot } from "@/lib/ingest-stats";
import { getLiveHub } from "@/lib/live-hub";
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

  const [o, activity, redisOk, lastPosition] = await Promise.all([
    getPlatformOverview(env.GPS_DEVICE_OFFLINE_THRESHOLD_SECONDS, now),
    listActivity({ page: 1, pageSize: 25, search: "", kind: "all", who: "platform" }),
    timed(async () => (await (await getReadyRedisPublisher()).ping()) === "PONG", 2000),
    timed(async () => {
      const [r] = await getDb().execute<{ at: Date | null }>(sql`select max(received_at) as at from location_history where received_at > now() - interval '1 day'`);
      return r?.at ? new Date(r.at).toISOString() : null;
    }, 3000)
  ]);
  // Sign-ins are noise here; they stay in the activity log.
  const recentActivity = activity.items.filter((a) => !a.action.startsWith("auth.")).slice(0, 8);
  const ingest = ingestSnapshot();
  const live = getLiveHub().stats();
  const firstName = (rc.user.name || "").split(" ")[0];
  const onlinePct = o.trackers.total ? Math.round((o.trackers.online / o.trackers.total) * 100) : 0;
  const positionsFresh = lastPosition ? now.getTime() - new Date(lastPosition).getTime() < 15 * 60_000 : false;

  return (
    <>
      <header className="relative mb-5 overflow-hidden rounded-xl bg-[linear-gradient(120deg,#0a2463_0%,#12357f_55%,#1d4fb8_100%)] px-5 py-5 text-white shadow-card sm:px-7 sm:py-6">
        <svg aria-hidden="true" viewBox="0 0 400 160" preserveAspectRatio="xMaxYMid slice" className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-1/2 sm:block">
          <path d="M150 160 230 0h34l-80 160z" fill="#ffffff" opacity="0.07" />
          <path d="M214 160 294 0h22l-80 160z" fill="#d81e2c" opacity="0.85" />
          <path d="M258 160 338 0h34l-80 160z" fill="#ffffff" opacity="0.1" />
        </svg>
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-medium text-white/75">RIO GPS platform console</p>
            <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{firstName ? `Hello, ${firstName}` : "Platform overview"}</h1>
            <p className="m-0 mt-1.5 text-sm text-white/85">
              {o.customers.active} active customer{o.customers.active === 1 ? "" : "s"} · {o.trackers.online} of {o.trackers.total} trackers online
              {o.attention.length > 0 ? ` · ${o.attention.length} need${o.attention.length === 1 ? "s" : ""} a look` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/customers?new=1" className="inline-flex h-10 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-[#0a2463] no-underline shadow-card hover:bg-white/90">
              <Plus className="size-4" aria-hidden="true" /> New customer
            </Link>
          </div>
        </div>
      </header>

      <section aria-label="Platform summary" className="stagger-in mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi href="/admin/customers" icon={Building2} label="Customers" value={o.customers.active} sub={`${o.customers.newLast30} new in 30 days${o.customers.suspended ? ` · ${o.customers.suspended} suspended` : ""}`} tone="navy" />
        <Kpi href="/admin/trackers?state=online" icon={Radio} label="Trackers online" value={o.trackers.online} sub={`${onlinePct}% of ${o.trackers.total}`} tone="green" bar={onlinePct} />
        <Kpi
          href="/admin/trackers?state=silent"
          icon={CircleOff}
          label="Silent 24 h+"
          value={o.trackers.silent24h + o.trackers.never}
          sub={o.trackers.never ? `${o.trackers.never} never reported` : "Trackers not heard from"}
          tone={o.trackers.silent24h + o.trackers.never > 0 ? "amber" : "slate"}
        />
        <Kpi href="/admin/customers?sort=members&direction=desc" icon={Users} label="Customer users" value={o.users.total} sub={`${o.users.signedInLast7} signed in this week`} tone="blue" />
      </section>

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
              <p className="m-0 mt-3 font-semibold text-[#0a2463]">Every customer looks healthy</p>
              <p className="m-0 mt-1 max-w-xs text-sm text-muted-foreground">Silent trackers, customers without trackers and customers nobody uses show up here.</p>
            </CardContent>
          ) : (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {o.attention.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/customers/${a.id}`} className="flex items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-primary-soft/40 sm:px-5">
                    <AttentionIcon issue={a.issue} />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{a.detail}</span>
                    </span>
                    {a.trackers > 0 && (
                      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
                        {a.trackers - a.silent}/{a.trackers} reporting
                      </span>
                    )}
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid h-fit gap-4">
          <Card>
            <CardHeader>
              <IconTitle icon={Server}>System health</IconTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <dl className="m-0 grid gap-2.5 text-sm">
                <Health label="Database" ok value="Connected" icon={Database} />
                <Health label="Live updates (Redis)" ok={redisOk === true} value={redisOk ? "Connected" : "Not reachable"} icon={Activity} />
                <Health
                  label="Latest tracker position"
                  ok={positionsFresh}
                  warn={!positionsFresh}
                  value={lastPosition ? <RelativeTime iso={lastPosition} /> : "None in 24 h"}
                  icon={Radio}
                />
                <Health label="Open live map streams" ok value={String(live.listeners)} icon={Users} />
              </dl>
              {Object.keys(ingest.totals).length > 0 && (
                <p className="m-0 mt-3 text-xs text-muted-foreground">
                  Since this server started (<RelativeTime iso={ingest.since} />): {ingest.totals.stored ?? 0} positions stored
                  {ingest.totals.unknown_device ? `, ${ingest.totals.unknown_device} from unregistered trackers` : ""}
                  {ingest.totals.store_failed ? `, ${ingest.totals.store_failed} failed` : ""}.
                </p>
              )}
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat href="/admin/leads" icon={Inbox} label="New leads" value={o.newLeads} highlight={o.newLeads > 0} />
            <MiniStat icon={Package} label="Loads in progress" value={o.loadsActive} />
          </div>
        </div>
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

const KPI_TONE = {
  navy: "bg-[linear-gradient(135deg,#0a2463,#12357f)]",
  green: "bg-[linear-gradient(135deg,#15803d,#166534)]",
  amber: "bg-[linear-gradient(135deg,#b45309,#92400e)]",
  slate: "bg-[linear-gradient(135deg,#526079,#3b4558)]",
  blue: "bg-[linear-gradient(135deg,#0369a1,#075985)]"
} as const;

function Kpi({ href, icon: Icon, label, value, sub, tone, bar }: { href: string; icon: typeof Cpu; label: string; value: number; sub: string; tone: keyof typeof KPI_TONE; bar?: number }) {
  return (
    <Link href={href} className={cn("group relative block overflow-hidden rounded-xl p-4 text-white no-underline shadow-card transition-transform duration-150 hover:-translate-y-0.5", KPI_TONE[tone])}>
      <Icon aria-hidden="true" className="pointer-events-none absolute -bottom-3 -right-2 size-20 text-white/15 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} />
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-white/85">{label}</p>
      <p className="m-0 mt-1.5 text-[34px] font-semibold leading-10 tabular-nums">{value}</p>
      <p className="m-0 mt-1 min-h-4 truncate text-xs text-white/85">{sub}</p>
      {bar !== undefined && (
        <span aria-hidden="true" className="relative mt-2.5 block h-1 overflow-hidden rounded-full bg-white/25">
          <span className="block h-full rounded-full bg-white" style={{ width: `${bar}%` }} />
        </span>
      )}
    </Link>
  );
}

function MiniStat({ href, icon: Icon, label, value, highlight }: { href?: string; icon: typeof Cpu; label: string; value: number; highlight?: boolean }) {
  const body = (
    <>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", highlight ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary")}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-muted-foreground">{label}</span>
        <span className="block text-xl font-semibold tabular-nums">{value}</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-xl border border-border bg-background p-4 text-foreground no-underline shadow-card";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-primary/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Health({ label, ok, warn, value, icon: Icon }: { label: string; ok: boolean; warn?: boolean; value: ReactNode; icon: typeof Cpu }) {
  const tone = ok ? "success" : warn ? "warning" : "danger";
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="m-0 flex shrink-0 items-center gap-2 font-medium">
        <span aria-hidden="true" className={cn("inline-block size-2 rounded-full", tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-danger")} />
        {value}
      </dd>
    </div>
  );
}

function AttentionIcon({ issue }: { issue: AttentionItem["issue"] }) {
  const look =
    issue === "all_silent" || issue === "some_silent"
      ? { cls: "bg-warning-soft text-warning", Icon: CircleOff }
      : issue === "no_trackers"
        ? { cls: "bg-info-soft text-info", Icon: Cpu }
        : issue === "suspended"
          ? { cls: "bg-danger-soft text-danger", Icon: AlertTriangle }
          : { cls: "bg-muted text-muted-foreground", Icon: Users };
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", look.cls)}>
      <look.Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
