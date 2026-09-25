"use client";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { authClient } from "@/lib/client/auth-client";

export function AccountForm({ name, email }: { name: string; email: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const next = String(f.get("newPassword") ?? "");
    if (next !== String(f.get("confirm") ?? "")) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.changePassword({
      currentPassword: String(f.get("currentPassword") ?? ""),
      newPassword: next,
      revokeOtherSessions: true
    });
    setBusy(false);
    if (err) {
      setError(err.status === 429 ? "Too many attempts. Try again in a minute." : err.message || "Could not change the password.");
      return;
    }
    form.reset();
    toast.success("Password changed. Other devices have been signed out.");
  }

  return (
    <>
      <PageHeader title="My account" description="Your sign-in details." breadcrumbs={[{ label: "Settings" }, { label: "My account" }]} />
      <div className="grid max-w-xl gap-4">
        <Card className="p-4">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="m-0 font-medium">{name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="m-0 break-all">{email}</dd>
          </dl>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <form method="post" onSubmit={onSubmit} className="grid gap-4 p-4 pt-0">
            <Field id="acc-cur" label="Current password" required>
              <Input id="acc-cur" name="currentPassword" type="password" autoComplete="current-password" required />
            </Field>
            <Field id="acc-new" label="New password" description="At least 12 characters." required>
              <Input id="acc-new" name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
            </Field>
            <Field id="acc-conf" label="Confirm new password" required>
              <Input id="acc-conf" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <div>
              <Button type="submit" loading={busy}>
                <KeyRound /> Change password
              </Button>
            </div>
            <p className="m-0 text-xs text-muted-foreground">Changing your password signs you out on your other devices.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
