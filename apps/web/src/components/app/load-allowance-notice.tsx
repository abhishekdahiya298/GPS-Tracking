import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import type { LoadAllowance } from "@/lib/plans";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Shown on the Loads pages once 80% of the month's included loads are used. Work never stops:
 * loads over the allowance are billed at the plan's extra-load price, and the notice says so.
 */
export function LoadAllowanceNotice({ allowance, planLink }: { allowance: LoadAllowance; planLink: boolean }) {
  if (!allowance) return null;
  const { used, included, extraLoadCents, level } = allowance;
  const extra = extraLoadCents > 0 ? `${money(extraLoadCents)} each` : "at no extra charge";
  const action = planLink ? (
    <Link href="/settings/plan" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      Plan &amp; usage
    </Link>
  ) : undefined;
  return level === "over" ? (
    <Alert tone="warning" title={`${used} of ${included} included loads used this month`} action={action}>
      You can keep creating loads. Loads that start tracking this month from now on are extra, {extra}.
    </Alert>
  ) : (
    <Alert tone="info" title={`${used} of ${included} included loads used this month`} action={action}>
      {included - used} included {included - used === 1 ? "load" : "loads"} left. After that, extra loads are {extra}.
    </Alert>
  );
}
