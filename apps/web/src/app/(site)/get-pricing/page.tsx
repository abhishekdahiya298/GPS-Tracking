import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = { title: `Get pricing · ${SITE.product}`, description: `Ask for a ${SITE.product} quote for your fleet.` };

export default function GetPricingPage() {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1fr_minmax(0,28rem)]">
      <div>
        <h1 className="m-0 text-3xl font-semibold tracking-tight">Get pricing</h1>
        <p className="m-0 mt-3 max-w-md text-muted-foreground">Pricing depends on how many vehicles you track and which trackers suit them. Tell us about your fleet and we will send a quote.</p>
        <ul className="m-0 mt-6 grid list-none gap-3 p-0 text-sm text-muted-foreground">
          <li>A quote for the trackers and the monthly plan</li>
          <li>Your account, vehicles and team set up for you</li>
          <li>Miles or kilometres, and your own time zone</li>
        </ul>
        <p className="mt-8 text-sm text-muted-foreground">
          Already a customer? <Link href="/login">Sign in</Link>.
        </p>
      </div>
      <LeadForm />
    </div>
  );
}
