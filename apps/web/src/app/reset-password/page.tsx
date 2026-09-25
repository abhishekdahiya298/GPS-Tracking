import { ResetForm } from "./reset-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set password · RIO GPS" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const valid = typeof token === "string" && /^[A-Za-z0-9_-]{16,200}$/.test(token) && !error;
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 380, margin: "10vh auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22 }}>Set your password</h1>
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <p role="alert" style={{ color: "#b00020" }}>
          This link is invalid or has expired. <a href="/forgot-password">Request a new one</a>.
        </p>
      )}
    </main>
  );
}
