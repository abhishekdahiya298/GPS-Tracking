import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { signupOptions } from "@/lib/signup";
import { AuthHeading } from "../auth-heading";
import { AuthTabs } from "../auth-tabs";
import { SignupFlow } from "./signup-flow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create account · RIO GPS" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ role?: string; code?: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");
  const [opts, sp] = await Promise.all([signupOptions(), searchParams]);
  const anyOpen = Object.values(opts.open).some(Boolean);
  if (!anyOpen) {
    return (
      <>
        <AuthHeading title="Create account" description="Accounts are set up by RIO GPS right now." />
        <p className="m-0 text-sm">
          Ask us for pricing at <a href="https://riogps.com">riogps.com</a>, or{" "}
          <Link href="/login" className="text-primary">
            sign in
          </Link>
          .
        </p>
      </>
    );
  }
  return (
    <>
      <AuthTabs active="signup" />
      <SignupFlow open={opts.open} phoneCheck={opts.phoneCheck} emailCheck={opts.emailCheck} initialRole={sp.role === "driver" || sp.code ? "driver" : null} initialCode={sp.code ?? ""} />
    </>
  );
}
