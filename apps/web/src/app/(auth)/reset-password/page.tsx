import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { AuthHeading } from "../auth-heading";
import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set password · RIO GPS" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{16,200}$/.test(token) && !error;
  return (
    <>
      <AuthHeading title="Set your password" description="Choose a password with at least 12 characters." />
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <Alert tone="danger" title="This link is invalid or has expired.">
          <Link href="/forgot-password" className="text-primary">
            Request a new link
          </Link>
        </Alert>
      )}
    </>
  );
}
