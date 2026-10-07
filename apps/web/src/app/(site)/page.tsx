import { getSessionCookie } from "better-auth/cookies";
import { BellRing, CalendarClock, FileBarChart, Hexagon, History, MapPinned, Share2, Wrench } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { VehicleTypeIcon } from "@/components/app/vehicle-type-icon";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: `${SITE.product} · ${SITE.tagline}`,
  description: "See every truck and trailer live, replay any trip, and get alerts for speeding, zones and offline trackers. Built for fleets in Canada and the United States."
};

const FEATURES = [
  { icon: MapPinned, title: "Live map", text: "Every vehicle on one map with its status: moving, idling, stopped or offline. Follow one truck or see the whole fleet." },
  { icon: History, title: "Trip history and playback", text: "Replay any day for any vehicle, with distance, top speed and every stop." },
  { icon: BellRing, title: "Alerts", text: "Speeding, entering or leaving a zone, ignition and offline trackers, in the app and by email." },
  { icon: Hexagon, title: "Zones", text: "Draw your yards, customer sites and no-go areas on the map and use them in alerts." },
  { icon: FileBarChart, title: "Reports", text: "Trips, stops, idling, speeding and mileage, on screen, as CSV, or emailed on a schedule." },
  { icon: Wrench, title: "Maintenance", text: "Service reminders by distance or date, counted from real GPS mileage." },
  { icon: CalendarClock, title: "Renewals", text: "Plates, insurance, inspections and permits with reminders before they expire." },
  { icon: Share2, title: "Share a live location", text: "Send a customer a temporary link to one vehicle. It expires on its own and you can turn it off." }
];

const PREVIEW = [
  { name: "Truck 14", type: "semi", state: "Moving", tone: "#15803d", detail: "62 mph" },
  { name: "Trailer 53-08", type: "trailer", state: "Stopped", tone: "#0369a1", detail: "Yard" },
  { name: "Truck 07", type: "truck", state: "Idling", tone: "#b45309", detail: "Engine on" },
  { name: "Van 02", type: "van", state: "Offline", tone: "#6b7280", detail: "2 h ago" }
];

export default async function HomePage() {
  // Signed-in customers go straight to their fleet.
  if (getSessionCookie(new Headers(await headers()), { cookiePrefix: "rio" })) redirect("/dashboard");

  return (
    <>
      <section className="border-b border-border bg-canvas">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2">
          <div>
            <p className="m-0 text-sm font-medium text-primary">{SITE.tagline}</p>
            <h1 className="m-0 mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-[42px] sm:leading-[1.1]">Know where every truck and trailer is, right now.</h1>
            <p className="m-0 mt-4 max-w-xl text-base leading-7 text-muted-foreground">
              {SITE.product} shows your whole fleet on a live map, keeps the history of every trip, and tells you when something needs attention. Miles or kilometres, your time zone, on any screen.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/get-pricing">Get pricing</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/#features">See what it does</Link>
              </Button>
            </div>
          </div>

          {/* An illustration of the product's own vehicle list, not a customer's data. */}
          <div aria-hidden="true" className="rounded-xl border border-border bg-background p-4 shadow-pop sm:p-5">
            <div className="grid grid-cols-4 gap-2">
              {[
                ["12", "Moving", "#15803d"],
                ["3", "Idling", "#b45309"],
                ["8", "Stopped", "#0369a1"],
                ["1", "Offline", "#6b7280"]
              ].map(([n, label, color]) => (
                <div key={label} className="rounded-lg border border-border px-2 py-2 text-center">
                  <div className="text-xl font-semibold tabular-nums">{n}</div>
                  <div className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground">
                    <span className="inline-block size-1.5 rounded-full" style={{ background: color }} />
                    {label}
                  </div>
                </div>
              ))}
            </div>
            <ul className="m-0 mt-3 list-none divide-y divide-border rounded-lg border border-border p-0">
              {PREVIEW.map((v) => (
                <li key={v.name} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full text-white" style={{ background: v.tone, ["--vehicle-icon-gap" as string]: v.tone }}>
                    <VehicleTypeIcon type={v.type} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{v.name}</span>
                  <span className="text-xs text-muted-foreground">{v.detail}</span>
                  <span className="w-16 text-right text-xs font-medium" style={{ color: v.tone }}>
                    {v.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="features" aria-labelledby="features-h" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 py-14 sm:px-6 sm:py-16">
        <h2 id="features-h" className="m-0 text-2xl font-semibold tracking-tight">
          Everything a dispatcher needs, nothing they don&apos;t
        </h2>
        <p className="m-0 mt-2 max-w-2xl text-muted-foreground">One place for where your vehicles are, where they have been, and what is due.</p>
        <ul className="m-0 mt-8 grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-lg border border-border bg-background p-5 shadow-card">
              <f.icon className="size-5 text-primary" aria-hidden="true" />
              <h3 className="m-0 mt-3 text-[15px] font-semibold">{f.title}</h3>
              <p className="m-0 mt-1.5 text-sm leading-6 text-muted-foreground">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" aria-labelledby="how-h" className="scroll-mt-16 border-y border-border bg-canvas">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <h2 id="how-h" className="m-0 text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="m-0 mt-8 grid list-none gap-4 p-0 md:grid-cols-3">
            {[
              ["Tell us about your fleet", "Send the pricing form. We reply with a quote for the trackers and the monthly plan."],
              ["Install the trackers", "A small GPS tracker goes in each vehicle or on each trailer. We set up your account and add your vehicles."],
              ["Sign in and see your fleet", "Invite your team, set your zones and alerts, and watch your vehicles as soon as the trackers report."]
            ].map(([title, text], i) => (
              <li key={title} className="rounded-lg border border-border bg-background p-5 shadow-card">
                <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <h3 className="m-0 mt-3 text-[15px] font-semibold">{title}</h3>
                <p className="m-0 mt-1.5 text-sm leading-6 text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="cta-h" className="mx-auto w-full max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-16">
        <h2 id="cta-h" className="m-0 text-2xl font-semibold tracking-tight">
          See what it would cost for your fleet
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-muted-foreground">Tell us how many vehicles you run and where. No obligation.</p>
        <div className="mt-6">
          <Button asChild size="lg">
            <Link href="/get-pricing">Get pricing</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
