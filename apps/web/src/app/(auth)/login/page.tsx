import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { isEmailEnabled } from "@/lib/email";
import Link from "next/link";
import { AuthHeading } from "../auth-heading";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · RIO GPS" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const { next } = await searchParams;
  const target = safeNext(next);
  if (session) redirect(target);
  return (
    <>
      <AuthHeading title="Sign in" description="Welcome back. Sign in to your fleet account." />
      <LoginForm next={target} />
      {isEmailEnabled() && (
        <p className="m-0 mt-4 text-center text-sm">
          <Link href="/forgot-password" className="text-primary no-underline hover:underline">
            Forgot your password?
          </Link>
        </p>
      )}
    </>
  );
}

/** Only same-site relative paths are allowed as post-login targets (no open redirect). */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  return next;
}
