import { redirect } from "next/navigation";
import { isEmailEnabled } from "@/lib/email";
import { ForgotForm } from "./forgot-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot password · RIO GPS" };

export default function ForgotPasswordPage() {
  if (!isEmailEnabled()) redirect("/login");
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 380, margin: "10vh auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22 }}>Forgot your password?</h1>
      <p style={{ color: "#555" }}>Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <ForgotForm />
      <p>
        <a href="/login">Back to sign in</a>
      </p>
    </main>
  );
}
