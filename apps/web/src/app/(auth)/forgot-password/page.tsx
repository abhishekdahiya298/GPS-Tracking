import { redirect } from "next/navigation";
import { isEmailEnabled } from "@/lib/email";
import { Mail } from "lucide-react";
import Link from "next/link";
import { AuthHeading } from "../auth-heading";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot password · RIO GPS" };

export default function ForgotPasswordPage() {
  if (!isEmailEnabled()) redirect("/login");
  return (
    <>
      <AuthHeading icon={Mail} title="Forgot your password?" description="Enter your email and we'll send you a link to choose a new one." />
      <ForgotForm />
      <p className="m-0 mt-4 text-center text-sm">
        <Link href="/login" className="text-primary no-underline hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
