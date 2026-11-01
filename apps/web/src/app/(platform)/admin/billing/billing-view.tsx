"use client";
import { AlertTriangle, Download } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { money, monthLabel } from "@/lib/plan-format";
import type { UsageLine } from "@/lib/plans";
import { CUSTOMER_STATUS } from "../customers/_shared/status-meta";

/**
 * Everything needed to invoice a month: each customer's plan, trackers, loads (included and
 * extra) and the amount. Counts come from the usage ledger, so they don't change when a
 * customer deletes or cancels loads afterwards.
 */
export function BillingView({ month, months, current, lines, archived }: { month: string; months: string[]; current: boolean; lines: UsageLine[]; archived: number }) {
  const router = useRouter();
  const sum = (f: (l: UsageLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const review = lines.filter((l) => l.longLoads > 0);

  return (
    <>
      <PageHeader
        title="Usage & billing"
        description="What each customer used in a month and what to invoice. Months are calendar months in each customer's time zone."
        actions={
          <>
            <Select aria-label="Month" value={month} onChange={(e) => router.push(`/admin/billing?month=${e.target.value}`)} className="w-44">
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </Select>
            <Button variant="secondary" asChild>
              <a href={`/api/admin/billing?month=${month}`} download>
                <Download /> Download CSV
              </a>
            </Button>
          </>
        }
      />
      {current && (
        <div className="mb-4">
          <Alert tone="info">{monthLabel(month)} isn&apos;t over yet: these are the amounts so far. Invoice once the month has ended.</Alert>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Customers" value={lines.filter((l) => l.amounts.totalCents > 0).length} />
        <StatCard label="Trackers" value={sum((l) => (l.plan?.modules.includes("gps") ? l.trackers : 0))} />
        <StatCard label="Loads" value={sum((l) => l.loadsUsed)} />
        <StatCard label="Total" value={money(sum((l) => l.amounts.totalCents))} />
      </div>
      {review.length > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="Check before invoicing">
            {review.map((l) => l.customerName).join(", ")}: {review.length === 1 ? "has" : "have"} loads tracked for more than 14 days. A load usually lasts a few days; a long one may be several shipments under one load.
          </Alert>
        </div>
      )}
      <Card>
        {lines.length === 0 ? (
          <EmptyState title="No usage this month" description="Customers appear here once they have a plan, trackers or loads." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH>Plan</TH>
                <TH className="text-right">Trackers</TH>
                <TH className="text-right">Loads</TH>
                <TH className="text-right">Extra loads</TH>
                <TH className="text-right">Amount</TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.organizationId}>
                  <TD>
                    <Link href={`/admin/customers/${l.organizationId}`} className="font-medium text-foreground no-underline hover:text-primary hover:underline">
                      {l.customerName}
                    </Link>
                    {l.customerStatus !== "active" && (
                      <StatusBadge tone={CUSTOMER_STATUS[l.customerStatus as keyof typeof CUSTOMER_STATUS]?.tone ?? "neutral"} label={CUSTOMER_STATUS[l.customerStatus as keyof typeof CUSTOMER_STATUS]?.label ?? l.customerStatus} className="ml-2" />
                    )}
                    {l.longLoads > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="size-3" aria-hidden="true" /> {l.longLoads} long load{l.longLoads === 1 ? "" : "s"}
                      </span>
                    )}
                  </TD>
                  <TD className="text-sm">{l.plan?.planName ?? <span className="text-muted-foreground">No plan</span>}</TD>
                  <TD className="text-right tabular-nums">
                    {l.plan?.modules.includes("gps") ? (
                      <>
                        {l.trackers}
                        <div className="text-xs text-muted-foreground">× {money(l.plan.perTrackerCents)}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {l.plan?.modules.includes("loads") ? (
                      <>
                        {l.loadsUsed}
                        <div className="text-xs text-muted-foreground">{l.plan.includedLoads > 0 ? `of ${l.plan.includedLoads} included` : "pay per load"}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {l.extraLoads > 0 ? (
                      <>
                        {l.extraLoads}
                        <div className="text-xs text-muted-foreground">× {money(l.plan?.extraLoadCents ?? 0)}</div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TD>
                  <TD className="text-right font-semibold tabular-nums">
                    {money(l.amounts.totalCents)}
                    {l.amounts.monthlyFeeCents > 0 && <div className="text-xs font-normal text-muted-foreground">incl. {money(l.amounts.monthlyFeeCents)} fee</div>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {archived > 0 && (
          <p className="m-0 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            {archived} archived customer{archived === 1 ? " isn't" : "s aren't"} shown: archived customers are never billed. Restore a customer to bill them again.
          </p>
        )}
      </Card>
    </>
  );
}
