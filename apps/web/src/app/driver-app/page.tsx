import { MapPin, ShieldCheck, Smartphone } from "lucide-react";
import { BrandMark } from "@/components/app/brand-mark";
import { StoreBadges } from "@/components/app/store-badges";
import { storeLinks } from "@/lib/app-releases";
import { peekDriverInvite } from "@/lib/driver-app";
import { getPlatformSettings } from "@/lib/platform-settings";
import { DriverAvatarChip } from "./join-chip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Driver app · RIO GPS", robots: { index: false, follow: false } };

/**
 * Where a driver's personal invite link lands (riogps.com/driver-app?t=…). On a phone with the app,
 * "Open the RIO GPS app" signs them in; without it, they install the app and tap the link again.
 */
export default async function DriverAppInvitePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const token = typeof t === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(t) ? t : null;
  const [stores, invite, platform] = await Promise.all([storeLinks(), token ? peekDriverInvite(token).catch((): Awaited<ReturnType<typeof peekDriverInvite>> => ({ state: "unknown" })) : Promise.resolve(null), getPlatformSettings()]);
  const usable = token && invite?.state === "ok";
  return (
    <main className="grid min-h-dvh place-items-center bg-[linear-gradient(160deg,#071a4a,#0a2463_45%,#1d4fb8)] px-5 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-pop">
        <div className="mb-5 flex justify-center">
          <BrandMark className="h-12" />
        </div>
        {invite?.companyName && <DriverAvatarChip driverName={invite.driverName!} companyName={invite.companyName} />}
        <h1 className="m-0 mt-4 text-center text-2xl font-semibold tracking-tight text-[#0a2463] dark:text-foreground">{invite?.companyName ? `Join ${invite.companyName}` : "Your driver app invite"}</h1>
        <p className="m-0 mt-2 text-center text-sm text-muted-foreground">
          {invite?.companyName ? `${invite.companyName} invited you to the RIO GPS driver app.` : "Your company invited you to RIO GPS."} Get your loads in the app and share your location with them while you&apos;re signed in.
        </p>
        {invite && invite.state !== "ok" ? (
          <p className="m-0 mt-5 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
            {invite.state === "used" ? "This link was already used. If that wasn't you, ask your company for a new one." : invite.state === "expired" ? "This link has expired. Ask your company to send a new one." : "This link isn't valid. Ask your company to send it again."}
          </p>
        ) : usable ? (
          <a href={`riogps://driver?t=${token}`} className="mt-5 flex h-12 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#1849c6,#0a2463)] text-[15px] font-semibold text-white no-underline shadow-pop">
            <Smartphone className="size-5" aria-hidden="true" /> Open the RIO GPS app
          </a>
        ) : (
          <p className="m-0 mt-5 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">This link isn&apos;t complete. Ask your company to send it again.</p>
        )}
        <ol className="m-0 mt-5 grid list-none gap-3 p-0 text-sm">
          <li className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">1</span>
            <span>No app yet? Install RIO GPS below, then come back and tap this link again.</span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">2</span>
            <span>
              Allow location <b>Always</b> when your phone asks, so your loads update by themselves.
            </span>
          </li>
        </ol>
        <div className="mt-5">
          <StoreBadges ios={stores.ios} android={stores.android} />
        </div>
        <ul className="m-0 mt-5 grid list-none gap-2 p-0 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">
            <MapPin className="size-4 text-success" aria-hidden="true" /> Your company sees your location while you&apos;re signed in.
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-success" aria-hidden="true" /> The link works once and expires in {platform.driverInviteDays} day{platform.driverInviteDays === 1 ? "" : "s"}.
          </li>
        </ul>
      </div>
    </main>
  );
}
