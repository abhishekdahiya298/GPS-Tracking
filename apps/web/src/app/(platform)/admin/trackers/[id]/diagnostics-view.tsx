"use client";
import {
  Activity,
  BatteryMedium,
  CardSim,
  CircleCheck,
  CircleHelp,
  CircleX,
  ExternalLink,
  Loader2,
  MapPin,
  Plug,
  RefreshCw,
  Satellite,
  Send,
  Signal,
  Zap,
  TriangleAlert,
  Wifi,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { RelativeTime } from "@/components/app/local-time";
import { PageHeader } from "@/components/app/page-header";
import { StatusBadge } from "@/components/app/status-badge";
import { useTime } from "@/components/app/time-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import type { TrackerDiagnostics } from "@/lib/tracker-diagnostics";
import {
  checkConfig,
  parseReply,
  TRACKER_COMMANDS,
  type HealthCheck,
  type HourBucket,
  type Level,
  type TrackerCommandId,
} from "@/lib/tracker-diagnostics-model";

/** Colours by level, from the app's theme (light and dark). */
const LEVEL: Record<
  Level,
  { soft: string; text: string; icon: typeof CircleCheck; word: string }
> = {
  ok: {
    soft: "bg-success-soft",
    text: "text-success",
    icon: CircleCheck,
    word: "OK",
  },
  warn: {
    soft: "bg-warning-soft",
    text: "text-warning",
    icon: TriangleAlert,
    word: "Check",
  },
  bad: {
    soft: "bg-danger-soft",
    text: "text-danger",
    icon: CircleX,
    word: "Problem",
  },
  unknown: {
    soft: "bg-muted",
    text: "text-muted-foreground",
    icon: CircleHelp,
    word: "Unknown",
  },
};
const CHECK_ICON: Record<HealthCheck["id"], typeof Wifi> = {
  connection: Wifi,
  gps: Satellite,
  power: Plug,
  battery: BatteryMedium,
  signal: Signal,
};

const RANGES = [6, 24, 72] as const;
const POLL_MS = 3_000;
const POLL_FOR_MS = 60_000;

type Reply = { at: string; text: string; command?: TrackerCommandId };

export function DiagnosticsView({ initial }: { initial: TrackerDiagnostics }) {
  const [data, setData] = useState(initial);
  const [hours, setHours] = useState(initial.range.hours);
  const [loading, setLoading] = useState(false);
  const t = initial.tracker;
  const name =
    t.vehicle?.name ?? t.name ?? `${t.model ?? "Tracker"} ${t.imei.slice(-4)}`;

  const load = useCallback(
    async (h: number) => {
      setLoading(true);
      try {
        setData(
          await api<TrackerDiagnostics>(
            `/api/admin/trackers/${t.id}/diagnostics?hours=${h}`,
          ),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't refresh");
      } finally {
        setLoading(false);
      }
    },
    [t.id],
  );

  return (
    <>
      <PageHeader
        title={`Diagnostics · ${name}`}
        description={[
          `IMEI ${t.imei}`,
          t.model,
          t.customer?.name ?? "In RIO stock",
        ]
          .filter(Boolean)
          .join(" · ")}
        breadcrumbs={[
          { label: "Platform", href: "/admin" },
          { label: "Trackers", href: "/admin/trackers" },
          { label: name },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label="Time range"
              value={String(hours)}
              onChange={(e) => {
                const h = Number(e.target.value);
                setHours(h);
                void load(h);
              }}
              className="h-9 w-36 bg-background text-foreground"
            >
              {RANGES.map((r) => (
                <option key={r} value={r}>
                  Last {r} hours
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => void load(hours)}
              disabled={loading}
            >
              <RefreshCw className={cn(loading && "animate-spin")} /> Refresh
            </Button>
          </div>
        }
      />

      <div
        className={cn("grid gap-4 transition-opacity", loading && "opacity-60")}
        aria-busy={loading}
      >
        <Verdict data={data} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {data.checks.map((c) => (
            <CheckCard key={c.id} check={c} />
          ))}
        </div>
        <Timeline
          buckets={data.buckets}
          hours={data.range.hours}
          totals={data.totals}
        />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Commands data={data} />
          <About data={data} />
        </div>
        <RecentReports data={data} />
      </div>
    </>
  );
}

function Verdict({ data }: { data: TrackerDiagnostics }) {
  const v = data.verdict;
  const L = LEVEL[v.level];
  const Icon = L.icon;
  return (
    <Card className={cn("flex items-start gap-3 border-0 p-4", L.soft)}>
      <Icon
        className={cn("mt-0.5 size-6 shrink-0", L.text)}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className={cn("m-0 text-base font-semibold", L.text)}>{v.title}</p>
        <p className="m-0 mt-0.5 text-sm text-foreground/85">{v.detail}</p>
        {data.traccar.error && (
          <p className="m-0 mt-1 text-sm text-danger">
            Traccar: {data.traccar.error}
          </p>
        )}
      </div>
    </Card>
  );
}

function CheckCard({ check }: { check: HealthCheck }) {
  const L = LEVEL[check.level];
  const Icon = CHECK_ICON[check.id];
  return (
    <Card className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" /> {check.label}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            L.soft,
            L.text,
          )}
        >
          {L.word}
        </span>
      </div>
      <p className="m-0 text-xl font-semibold tabular-nums">{check.value}</p>
      <p className="m-0 text-xs leading-snug text-muted-foreground">
        {check.detail}
      </p>
    </Card>
  );
}

/** Hour strip (green = GPS, amber = reports without GPS, grey = silent) plus satellites and voltage charts. */
function Timeline({
  buckets,
  hours,
  totals,
}: {
  buckets: HourBucket[];
  hours: number;
  totals: TrackerDiagnostics["totals"];
}) {
  const time = useTime();
  const labelEvery = hours <= 6 ? 1 : hours <= 24 ? 4 : 12;
  const colour = (b: HourBucket) =>
    b.reports === 0
      ? "bg-muted"
      : b.fixes > 0
        ? b.fixes === b.reports
          ? "bg-success"
          : "bg-success/60"
        : "bg-warning";
  const sats = buckets.map((b) => b.maxSatellites);
  const ext = buckets.map((b) => b.minExternalV);
  const bat = buckets.map((b) => b.minBatteryV);
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
          <Activity className="size-4" aria-hidden="true" /> Last {hours} hours
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          {totals.reports.toLocaleString()} reports ·{" "}
          {totals.fixes.toLocaleString()} with GPS
          {totals.truncated ? " · showing the newest only" : ""}
        </p>
      </div>
      <div
        className="flex h-9 gap-px overflow-hidden rounded-md"
        role="img"
        aria-label={`Hourly reports over the last ${hours} hours`}
      >
        {buckets.map((b) => (
          <Tooltip
            key={b.start}
            side="top"
            content={
              <span className="text-xs">
                {time.dateTime(b.start)}:{" "}
                {b.reports === 0
                  ? "no reports"
                  : `${b.reports} reports, ${b.fixes} with GPS`}
                {b.maxSatellites !== null
                  ? `, up to ${b.maxSatellites} satellites`
                  : ""}
              </span>
            }
          >
            <div className={cn("h-full flex-1 cursor-default", colour(b))} />
          </Tooltip>
        ))}
      </div>
      <div
        className="relative mt-1 h-4 text-[11px] text-muted-foreground"
        aria-hidden="true"
      >
        {buckets.map((b, i) =>
          i % labelEvery === 0 ? (
            <span
              key={b.start}
              className="absolute whitespace-nowrap"
              style={{ left: `${(i / buckets.length) * 100}%` }}
            >
              {time.time(b.start)}
            </span>
          ) : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legend className="bg-success" label="Reporting with GPS" />
        <Legend className="bg-warning" label="Reporting, no GPS" />
        <Legend className="bg-muted" label="No reports" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Spark
          title="Satellites (best each hour)"
          series={[
            { values: sats, className: "stroke-primary", label: "Satellites" },
          ]}
          min={0}
          unit=""
        />
        <Spark
          title="Power (lowest each hour, volts)"
          series={[
            {
              values: ext,
              className: "stroke-success",
              label: "Vehicle power",
            },
            {
              values: bat,
              className: "stroke-warning",
              label: "Internal battery",
            },
          ]}
          min={0}
          unit=" V"
        />
      </div>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn("inline-block size-2.5 rounded-sm", className)}
        aria-hidden="true"
      />{" "}
      {label}
    </span>
  );
}

/** A tiny line chart with gaps where there is no data; last value printed on the right. */
function Spark({
  title,
  series,
  min,
  unit,
}: {
  title: string;
  series: { values: (number | null)[]; className: string; label: string }[];
  min: number;
  unit: string;
}) {
  const W = 300;
  const H = 96;
  const all = series
    .flatMap((s) => s.values)
    .filter((v): v is number => v !== null);
  const max = Math.max(min + 1, ...all);
  const n = Math.max(1, (series[0]?.values.length ?? 1) - 1);
  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const x = (i / n) * W;
      const y = H - 4 - ((v - min) / (max - min)) * (H - 8);
      d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const last = (values: (number | null)[]) =>
    [...values].reverse().find((v) => v !== null) ?? null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="flex gap-3 text-xs text-muted-foreground">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <svg width="14" height="6" aria-hidden="true">
                <line
                  x1="0"
                  y1="3"
                  x2="14"
                  y2="3"
                  className={s.className}
                  strokeWidth="2"
                />
              </svg>
              {s.label}:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {last(s.values) === null ? "—" : `${last(s.values)}${unit}`}
              </span>
            </span>
          ))}
        </span>
      </div>
      {all.length === 0 ? (
        <p className="m-0 flex h-24 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
          Not in this tracker&apos;s reports
        </p>
      ) : (
        <div className="relative">
          <span className="absolute left-1.5 top-0.5 text-[10px] tabular-nums text-muted-foreground">
            {max % 1 ? max.toFixed(1) : max}
            {unit}
          </span>
          <span className="absolute bottom-0.5 left-1.5 text-[10px] tabular-nums text-muted-foreground">
            {min}
            {unit}
          </span>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-24 w-full rounded-md bg-muted/50"
            role="img"
            aria-label={title}
          >
            <line
              x1="0"
              x2={W}
              y1={H / 2}
              y2={H / 2}
              className="stroke-border"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            {series.map((s) => (
              <path
                key={s.label}
                d={path(s.values)}
                fill="none"
                className={s.className}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

/** Questions and quick actions; replies polled for a minute after each send. */
function Commands({ data }: { data: TrackerDiagnostics }) {
  const time = useTime();
  const id = data.tracker.id;
  const [replies, setReplies] = useState<Reply[]>(data.replies);
  const [waiting, setWaiting] = useState<{
    command: TrackerCommandId;
    status: "sent" | "queued";
    since: string;
  } | null>(null);
  const [busy, setBusy] = useState<TrackerCommandId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supported =
    data.traccar.protocol === null || data.traccar.protocol === "teltonika";

  useEffect(
    () => setReplies((r) => mergeReplies(r, data.replies)),
    [data.replies],
  );
  useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    [],
  );

  const poll = useCallback(
    (since: string, command: TrackerCommandId, until: number) => {
      timer.current = setTimeout(async () => {
        try {
          const r = await api<{ replies: Reply[] }>(
            `/api/admin/trackers/${id}/diagnostics?since=${encodeURIComponent(since)}`,
          );
          if (r.replies.length) {
            setReplies((old) =>
              mergeReplies(
                old,
                r.replies.map((x) => ({ ...x, command })),
              ),
            );
            setWaiting(null);
            return;
          }
        } catch {
          // keep polling until the deadline
        }
        if (Date.now() < until) poll(since, command, until);
        else setWaiting((w) => (w ? { ...w, status: "queued" } : w));
      }, POLL_MS);
    },
    [id],
  );

  const send = async (command: TrackerCommandId) => {
    setBusy(command);
    try {
      const r = await api<{ status: "sent" | "queued"; sentAt: string }>(
        `/api/admin/trackers/${id}/command`,
        { method: "POST", json: { command } },
      );
      if (timer.current) clearTimeout(timer.current);
      setWaiting({ command, status: r.status, since: r.sentAt });
      poll(r.sentAt, command, Date.now() + POLL_FOR_MS);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't send the command",
      );
    } finally {
      setBusy(null);
    }
  };

  const isTrailer = data.tracker.vehicle?.type === "trailer";
  const [confirming, setConfirming] = useState<(typeof TRACKER_COMMANDS)[number] | null>(null);
  const group = (kind: "read" | "action") => TRACKER_COMMANDS.filter((c) => c.kind === kind);
  const button = (c: (typeof TRACKER_COMMANDS)[number]) => (
    <button
      key={c.id}
      type="button"
      disabled={!supported || busy !== null}
      onClick={() => ("confirm" in c && c.confirm ? setConfirming(c) : void send(c.id))}
      className="flex items-start gap-2 rounded-lg border border-border bg-background p-2.5 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy === c.id ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : c.kind === "action" ? (
        <Zap className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      ) : (
        <Send className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="block text-sm font-medium">
          {c.label}{" "}
          <code className="ml-1 text-[11px] font-normal text-muted-foreground">{"data" in c ? "getparam" : c.id}</code>
        </span>
        <span className="block text-xs text-muted-foreground">{c.explains}</span>
      </span>
    </button>
  );
  const label = (id: string | undefined) => TRACKER_COMMANDS.find((c) => c.id === id)?.label;

  return (
    <Card className="p-4">
      <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
        <Send className="size-4" aria-hidden="true" /> Ask the tracker
      </h2>
      <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
        Sent over its data connection. None of these change its settings. Each one is recorded in Activity.
      </p>
      {!supported && (
        <p className="m-0 mt-2 rounded-md bg-muted p-2 text-[13px]">
          Commands are available for Teltonika trackers only (this one uses {data.traccar.protocol}).
        </p>
      )}
      <h3 className="m-0 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Questions</h3>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">{group("read").map(button)}</div>
      <h3 className="m-0 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick actions</h3>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">{group("action").map(button)}</div>

      {waiting && (
        <p className={cn("m-0 mt-3 flex items-center gap-2 rounded-md p-2 text-[13px]", waiting.status === "queued" ? "bg-warning-soft" : "bg-info-soft")}>
          {waiting.status === "sent" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <TriangleAlert className="size-4" aria-hidden="true" />}
          {waiting.status === "sent"
            ? waiting.command === "cpureset"
              ? "Restart sent. The tracker reconnects in about a minute (no reply is expected)."
              : `Sent “${label(waiting.command)}”. Waiting for the tracker’s reply…`
            : `No reply yet to “${label(waiting.command)}”. The tracker is asleep or out of coverage. It gets the command the next time it connects: within a minute when driving, up to 4 hours when parked. This page shows the reply when it arrives.`}
        </p>
      )}

      <h3 className="m-0 mt-4 text-sm font-semibold">Replies</h3>
      {replies.length === 0 ? (
        <p className="m-0 mt-1 text-[13px] text-muted-foreground">No replies in this time range yet.</p>
      ) : (
        <ul className="m-0 mt-2 grid list-none gap-2 p-0">
          {replies.slice(0, 12).map((r) => {
            const cfg = checkConfig(r.text, isTrailer);
            return (
              <li key={`${r.at}-${r.text}`} className="rounded-lg border border-border p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{cfg ? "Settings check" : r.command ? <code>{r.command}</code> : "Reply"}</span>
                  <time dateTime={r.at} title={time.full(r.at)}>
                    {time.dateTimeSec(r.at)}
                  </time>
                </div>
                {cfg ? <ConfigTable rows={cfg} isTrailer={isTrailer} raw={r.text} /> : <ReplyChips text={r.text} />}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming?.label ?? ""}
        description={confirming && "confirm" in confirming ? confirming.confirm : undefined}
        confirmLabel={confirming?.label ?? "Send"}
        destructive={confirming?.id === "cpureset"}
        onConfirm={async () => {
          if (confirming) await send(confirming.id);
        }}
      />
    </Card>
  );
}

/** Settings read from the tracker, ✓/✗ against RIO's standard config. */
function ConfigTable({ rows, isTrailer, raw }: { rows: NonNullable<ReturnType<typeof checkConfig>>; isTrailer: boolean; raw: string }) {
  const bad = rows.filter((r) => !r.ok);
  const critical = bad.filter((r) => r.severity === "critical");
  return (
    <div>
      <p className={cn("m-0 mb-2 rounded-md p-2 text-[13px] font-medium", critical.length ? "bg-danger-soft text-danger" : bad.length ? "bg-warning-soft" : "bg-success-soft text-success")}>
        {critical.length
          ? `Can’t reach RIO correctly: ${critical.map((r) => r.label).join(", ")} wrong. Fix it before anything else.`
          : bad.length
            ? `Reaches RIO. ${bad.length} setting${bad.length === 1 ? " differs" : "s differ"} from the RIO standard (${isTrailer ? "RIO-GPS-FTM164-trailer-v2" : "RIO-GPS-FTM880-v2"}).`
            : `Matches the RIO standard (${isTrailer ? "RIO-GPS-FTM164-trailer-v2" : "RIO-GPS-FTM880-v2"}).`}
      </p>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Setting</th>
            <th className="py-1 pr-2 font-medium">On the tracker</th>
            <th className="py-1 font-medium">RIO standard</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1 pr-2">{r.label}</td>
              <td className={cn("py-1 pr-2 font-medium", r.ok ? "text-success" : r.severity === "critical" ? "text-danger" : "text-warning")}>
                {r.ok ? "✓ " : "✗ "}
                {r.actual ?? "not returned"}
              </td>
              <td className="py-1 text-muted-foreground">{r.expected}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="mt-1.5 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Raw reply</summary>
        <p className="m-0 mt-1 break-words font-mono">{raw}</p>
      </details>
    </div>
  );
}

/** Highlights the values that matter most when diagnosing GPS and power. */
const KEY_HINT: Record<string, string> = {
  GPS: "1 = valid GPS position, 0 = none",
  Sat: "Satellites in use",
  SAT: "Satellites in use",
  GNSS: "GNSS state: 1 off, 2 searching, 3 fix",
  NOGPS: "Time without GPS (h:min)",
  TTFF: "Seconds to first fix (0 = never)",
  ExtV: "Vehicle power, millivolts",
  BatV: "Internal battery, millivolts",
  Signal: "Cell signal (0–5)",
  POWER: "1 = GPS chip powered",
};

function ReplyChips({ text }: { text: string }) {
  const pairs = parseReply(text);
  if (pairs.length < 2)
    return <p className="m-0 break-words font-mono text-xs">{text}</p>;
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {pairs.map((p, i) => {
          const hint = KEY_HINT[p.key];
          const chip = (
            <span
              className={cn(
                "inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]",
                hint
                  ? "bg-primary/10 text-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {p.key}
              <b className="font-semibold text-foreground">{p.value}</b>
            </span>
          );
          return hint ? (
            <Tooltip
              key={`${p.key}-${i}`}
              content={<span className="text-xs">{hint}</span>}
            >
              {chip}
            </Tooltip>
          ) : (
            <span key={`${p.key}-${i}`}>{chip}</span>
          );
        })}
      </div>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          Raw reply
        </summary>
        <p className="m-0 mt-1 break-words font-mono text-[11px]">{text}</p>
      </details>
    </div>
  );
}

function mergeReplies(a: Reply[], b: Reply[]): Reply[] {
  const seen = new Map<string, Reply>();
  for (const r of [...b, ...a]) {
    const k = `${r.at}|${r.text}`;
    if (!seen.has(k)) seen.set(k, r);
    else if (r.command && !seen.get(k)!.command) seen.set(k, r);
  }
  return [...seen.values()].sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
}

function About({ data }: { data: TrackerDiagnostics }) {
  const time = useTime();
  const t = data.tracker;
  const fix = t.lastFix;
  return (
    <Card className="flex flex-col gap-4 p-4">
      <section>
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
          <MapPin className="size-4" aria-hidden="true" /> Last GPS position
        </h2>
        {fix ? (
          <div className="mt-1 text-sm">
            <p className="m-0">
              <RelativeTime iso={fix.at} /> ·{" "}
              <span className="text-muted-foreground">
                {time.dateTime(fix.at)}
              </span>
            </p>
            <p className="m-0 font-mono text-[13px]">
              {fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)}
            </p>
            <a
              className="mt-1 inline-flex items-center gap-1 text-[13px] text-primary"
              href={`https://www.google.com/maps?q=${fix.latitude},${fix.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Google Maps{" "}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        ) : (
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            No GPS position stored yet.
          </p>
        )}
      </section>
      <Facts
        title="Tracker"
        icon={<Activity className="size-4" aria-hidden="true" />}
        rows={[
          [
            "Server connection",
            data.traccar.connected ? (
              <StatusBadge key="c" tone="success" label="Connected now" />
            ) : (
              <StatusBadge key="c" tone="neutral" label="Not connected" />
            ),
          ],
          [
            "Last message",
            <RelativeTime
              key="m"
              iso={data.traccar.lastMessageAt ?? t.lastSeenAt}
            />,
          ],
          ["Customer", t.customer?.name ?? "RIO stock"],
          ["Vehicle", t.vehicle?.name ?? "Not on a vehicle"],
          ["Model", t.model ?? "—"],
          ["Serial", t.serialNumber ?? "—"],
          ["Protocol", data.traccar.protocol ?? "—"],
        ]}
      />
      <Facts
        title="SIM"
        icon={<CardSim className="size-4" aria-hidden="true" />}
        rows={
          t.sim
            ? [
                [
                  "ICCID",
                  <span key="i" className="font-mono text-[12px]">
                    {t.sim.iccid}
                  </span>,
                ],
                ["Status", t.sim.status],
                ["Plan", t.sim.plan ?? "—"],
                ["Phone number", t.sim.msisdn ?? "—"],
                [
                  "Carrier",
                  t.sim.provider === "hologram"
                    ? "Hologram"
                    : (t.sim.provider ?? "—"),
                ],
              ]
            : [["SIM", "None recorded for this tracker"]]
        }
        footer={
          <Link href="/admin/sims" className="text-[13px] text-primary">
            Open SIM cards
          </Link>
        }
      />
    </Card>
  );
}

function Facts({
  title,
  icon,
  rows,
  footer,
}: {
  title: string;
  icon: ReactNode;
  rows: [string, ReactNode][];
  footer?: ReactNode;
}) {
  return (
    <section>
      <h2 className="m-0 flex items-center gap-2 text-base font-semibold">
        {icon} {title}
      </h2>
      <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="m-0 min-w-0 truncate">{v}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-1">{footer}</div>}
    </section>
  );
}

function RecentReports({ data }: { data: TrackerDiagnostics }) {
  const time = useTime();
  const [all, setAll] = useState(false);
  const rows = all ? data.recent : data.recent.slice(0, 15);
  const v = (n: number | null, unit: string, digits = 1) =>
    n === null ? "—" : `${n.toFixed(digits)}${unit}`;
  const columns = useMemo(
    () => [
      "Recorded",
      "GPS",
      "Satellites",
      "Position",
      "Speed",
      "Vehicle power",
      "Battery",
      "Ignition",
      "Signal",
    ],
    [],
  );
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 p-4 pb-2">
        <h2 className="m-0 text-base font-semibold">Recent reports</h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          Straight from the tracker, including the ones without GPS that never
          reach the map.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 p-4 pt-0 text-sm text-muted-foreground">
          No reports in this time range.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 font-medium"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.at}-${r.receivedAt}`}
                  className={cn(
                    "border-t border-border",
                    !r.fix && "bg-warning-soft/40",
                  )}
                >
                  <td
                    className="whitespace-nowrap px-3 py-1.5 tabular-nums"
                    title={`Received ${time.full(r.receivedAt)}`}
                  >
                    {time.dateTimeSec(r.at)}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.fix ? (
                      <StatusBadge tone="success" label="Fix" />
                    ) : (
                      <StatusBadge tone="warning" label="No GPS" />
                    )}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {r.satellites ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px]">
                    {r.fix
                      ? `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {r.fix ? `${Math.round(r.speedKph)} km/h` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {v(r.externalV, " V")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {v(r.batteryV, " V", 2)}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.ignition === null ? "—" : r.ignition ? "On" : "Off"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {r.signal === null ? "—" : `${r.signal}/5`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.recent.length > 15 && (
            <div className="border-t border-border p-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAll((v) => !v)}
              >
                {all ? "Show fewer" : `Show all ${data.recent.length}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
