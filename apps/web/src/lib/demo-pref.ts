import { cookies } from "next/headers";
import { HIDE_DEMO_COOKIE } from "./demo-pref-shared";

/** Platform admins can hide demo / internal test customers from the console lists and totals. */
export async function hideDemoAccounts(): Promise<boolean> {
  return (await cookies()).get(HIDE_DEMO_COOKIE)?.value === "1";
}
