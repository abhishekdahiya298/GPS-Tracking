"use client";
import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api, errorMessage } from "@/lib/client/api";

/** Delete my account (the app stores require it once anyone can sign up). */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/delete", { method: "POST", json: { password, confirm } });
      window.location.assign("/login?deleted=1");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
      </CardHeader>
      <div className="grid gap-3 p-4 text-sm">
        <p className="m-0 text-muted-foreground">Removes your sign-in for good. If you&apos;re the only person in your company, the company is closed too. This can&apos;t be undone from here.</p>
        <Button variant="secondary" className="w-fit text-danger" onClick={() => setOpen(true)}>
          <Trash2 /> Delete my account
        </Button>
      </div>
      {open && (
        <Dialog open onOpenChange={(o) => !busy && !o && setOpen(false)}>
          <DialogContent title="Delete your account?" description="Type DELETE and your password to confirm." className="max-w-md">
            <form onSubmit={submit} className="grid gap-4">
              <Field id="del-confirm" label="Type DELETE" required>
                <Input id="del-confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              <Field id="del-pass" label="Password" required>
                <PasswordInput id="del-pass" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && <Alert tone="danger">{error}</Alert>}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" loading={busy} disabled={confirm !== "DELETE" || !password}>
                  Delete account
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
