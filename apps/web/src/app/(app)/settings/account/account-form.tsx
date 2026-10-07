"use client";
import { dateFormatter, zoneLabel, type TimeFormat } from "@rio-gps/core/timezones";
import { Clock, KeyRound, LocateFixed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { SegmentedFilter } from "@/components/app/filter-bar";
import { TimeZoneSelect, deviceTimeZone } from "@/components/app/time-zone-select";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH, PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth-client";
import { TwoStepCard } from "./two-step-card";

type Prefs = { timeZone: string | null; timeFormat: TimeFormat | null };

export function AccountForm({ name, email, prefs, orgDefaults, twoStep }: { name: string; email: string; prefs: Prefs; twoStep: boolean; orgDefaults: { timeZone: string; timeFormat: TimeFormat } }) {
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
      <div className="grid min-w-0 max-w-xl gap-4">
        <Card className="p-4">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="m-0 font-medium">{name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="m-0 break-all">{email}</dd>
          </dl>
        </Card>
        <TimePreferences initial={prefs} orgDefaults={orgDefaults} />
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <form method="post" onSubmit={onSubmit} className="grid gap-4 p-4 pt-0">
            <Field id="acc-cur" label="Current password" required>
              <PasswordInput id="acc-cur" name="currentPassword" autoComplete="current-password" required />
            </Field>
            <Field id="acc-new" label="New password" description="At least 6 characters." required>
              <PasswordInput id="acc-new" name="newPassword" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={128} />
            </Field>
            <Field id="acc-conf" label="Confirm new password" required>
              <PasswordInput id="acc-conf" name="confirm" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={128} />
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
        <TwoStepCard enabled={twoStep} />
      </div>
    </>
  );
}

/** Personal time zone and clock. "" / null = follow the organization (the usual choice). */
function TimePreferences({ initial, orgDefaults }: { initial: Prefs; orgDefaults: { timeZone: string; timeFormat: TimeFormat } }) {
  const router = useRouter();
  const [tz, setTz] = useState(initial.timeZone ?? "");
  const [clock, setClock] = useState<TimeFormat | "org">(initial.timeFormat ?? "org");
  const [saving, setSaving] = useState(false);
  const next: Prefs = { timeZone: tz || null, timeFormat: clock === "org" ? null : clock };
  const dirty = next.timeZone !== initial.timeZone || next.timeFormat !== initial.timeFormat;
  const eff = dateFormatter(next.timeZone ?? orgDefaults.timeZone, next.timeFormat ?? orgDefaults.timeFormat);
  // The device zone is only known in the browser; read it after hydration.
  const [device, setDevice] = useState<string | null>(null);
  useEffect(() => setDevice(deviceTimeZone()), []);
  const orgFmt = dateFormatter(orgDefaults.timeZone);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <Clock className="size-4" aria-hidden="true" /> Time zone and clock
          </span>
        </CardTitle>
      </CardHeader>
      <div className="grid min-w-0 gap-4 p-4 pt-0">
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="acc-tz" className="text-sm font-medium">
            Time zone
          </label>
          <TimeZoneSelect
            id="acc-tz"
            aria-describedby="acc-tz-help"
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            defaultOption={`Organization default: ${zoneLabel(orgDefaults.timeZone)} (${orgFmt.abbr()})`}
          />
          <p id="acc-tz-help" className="m-0 text-xs text-muted-foreground">
            Choose your own only if you work in a different zone from your team, for example a dispatcher in Vancouver for a Toronto fleet.
          </p>
          {device && device !== (tz || orgDefaults.timeZone) && (
            <div>
              <Button type="button" variant="ghost" size="sm" className="h-auto whitespace-normal py-1 text-left" onClick={() => setTz(device)}>
                <LocateFixed /> Use this device&apos;s time zone ({device.replace(/_/g, " ")})
              </Button>
            </div>
          )}
        </div>
        <div className="grid gap-1.5">
          <p className="m-0 text-sm font-medium">Clock</p>
          <SegmentedFilter
            label="Clock"
            value={clock}
            onChange={setClock}
            options={[
              { value: "org", label: `Organization (${orgDefaults.timeFormat === "24h" ? "24-hour" : "12-hour"})` },
              { value: "12h", label: "12-hour" },
              { value: "24h", label: "24-hour" }
            ]}
          />
        </div>
        <p className="m-0 rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
          Times will look like: <span className="font-medium" suppressHydrationWarning>{eff.full(Date.now())}</span>
        </p>
        <div>
          <Button
            type="button"
            disabled={!dirty}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api("/api/account/preferences", { method: "PATCH", json: next });
                toast.success("Time preferences saved.");
                router.refresh();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}
