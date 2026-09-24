import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · RIO GPS" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const { next } = await searchParams;
  const target = safeNext(next);
  if (session) redirect(target);
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 360, margin: "10vh auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22 }}>RIO GPS</h1>
      <p style={{ color: "#555" }}>Sign in to your fleet account.</p>
      <LoginForm next={target} />
    </main>
  );
}

/** Only same-site relative paths are allowed as post-login targets (no open redirect). */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/dashboard";
  return next;
}
