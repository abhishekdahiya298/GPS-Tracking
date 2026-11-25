import { Archive, Building2, Power } from "lucide-react";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/app/sign-out-button";
import { getPlatformSettings } from "@/lib/platform-settings";
import { getRequestContext } from "@/lib/request-context";
import { AuthHeading } from "../auth-heading";

export const dynamic = "force-dynamic";
export const metadata = { title: "No access · RIO GPS" };

/** Signed in, but there is no company this person can open. */
export default async function NoAccessPage() {
  const rc = await getRequestContext();
  if (rc.status === "unauthenticated") redirect("/login");
  if (rc.status === "ok") redirect("/dashboard");
  if (rc.status === "platform") redirect("/admin");
  const { supportEmail, supportPhone } = await getPlatformSettings();
  const support = `RIO GPS support (${supportEmail}${supportPhone ? `, ${supportPhone}` : ""})`;
  const copy =
    rc.status === "organization_unavailable"
      ? rc.organizationStatus === "suspended"
        ? { icon: Power, tone: "orange" as const, title: "Account suspended", text: `Your company's RIO GPS account is suspended, so it can't be opened right now. Your data is kept. Contact your administrator or ${support} to reactivate it.` }
        : { icon: Archive, tone: "red" as const, title: "Account closed", text: `Your company's RIO GPS account has been closed. Contact ${support} if this is a mistake.` }
      : { icon: Building2, tone: "blue" as const, title: "No company yet", text: "Your account isn't a member of any company. Ask your administrator to invite you." };
  return (
    <>
      <AuthHeading icon={copy.icon} tone={copy.tone} title={copy.title} description={copy.text} />
      <p className="m-0 mb-4 text-sm text-muted-foreground">
        Signed in as <strong className="text-foreground">{rc.user.email}</strong>
      </p>
      <SignOutButton />
    </>
  );
}
