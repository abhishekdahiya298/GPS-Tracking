import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/app/sign-out-button";
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
  const copy =
    rc.status === "organization_unavailable"
      ? rc.organizationStatus === "suspended"
        ? { title: "Account suspended", text: "Your company's RIO GPS account is suspended, so it can't be opened right now. Your data is kept. Contact your administrator or RIO GPS support (support@riogps.com) to reactivate it." }
        : { title: "Account closed", text: "Your company's RIO GPS account has been closed. Contact RIO GPS support (support@riogps.com) if this is a mistake." }
      : { title: "No company yet", text: "Your account isn't a member of any company. Ask your administrator to invite you." };
  return (
    <>
      <AuthHeading title={copy.title} description={copy.text} />
      <p className="m-0 mb-4 text-sm text-muted-foreground">
        Signed in as <strong className="text-foreground">{rc.user.email}</strong>
      </p>
      <SignOutButton />
    </>
  );
}
