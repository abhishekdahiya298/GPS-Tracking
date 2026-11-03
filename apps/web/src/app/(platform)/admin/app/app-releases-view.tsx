"use client";
import { compareVersions } from "@rio-gps/core/app-version";
import { Apple, Download, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTime } from "@/components/app/time-context";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { AppReleaseDto } from "@/lib/app-releases";

const LABEL = { android: { name: "Android", icon: Smartphone, store: "https://play.google.com/store/apps/details?id=…" }, ios: { name: "iPhone (iOS)", icon: Apple, store: "https://apps.apple.com/app/id…" } } as const;

/**
 * Update policy per platform. "Latest" offers an update people can postpone; "Required" blocks
 * older apps until they update (and the API refuses them).
 */
export function AppReleasesView({ releases }: { releases: AppReleaseDto[] }) {
  return (
    <>
      <PageHeader title="Mobile app" description="Tell installed apps when a new version is out, and make an update required when older versions must stop being used." />
      <div className="mb-4">
        <Alert tone="info" title="How to release an update">
          <ol className="m-0 grid gap-1 pl-5">
            <li>Raise the app version (for example 1.3.0) and publish the new build to the store.</li>
            <li>
              When it is live, enter it here as <strong>Latest version</strong>: everyone on an older version sees &ldquo;Update available&rdquo;.
            </li>
            <li>
              Only if older versions must stop working, also set it as <strong>Required version</strong>: older apps show a full-screen &ldquo;Update required&rdquo; and can&apos;t be used until they update.
            </li>
          </ol>
        </Alert>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {releases.map((r) => (
          <PlatformCard key={r.platform} r={r} />
        ))}
      </div>
    </>
  );
}

function PlatformCard({ r }: { r: AppReleaseDto }) {
  const router = useRouter();
  const time = useTime();
  const meta = LABEL[r.platform];
  const [v, setV] = useState({ latestVersion: r.latestVersion ?? "", minVersion: r.minVersion ?? "", updateUrl: r.updateUrl ?? "", notes: r.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v, value: string) => setV((s) => ({ ...s, [k]: value }));
  const dirty = v.latestVersion !== (r.latestVersion ?? "") || v.minVersion !== (r.minVersion ?? "") || v.updateUrl !== (r.updateUrl ?? "") || v.notes !== (r.notes ?? "");
  const raisingMin = v.minVersion && (!r.minVersion || compareVersions(v.minVersion, r.minVersion) > 0);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/app-releases/${r.platform}`, { method: "PUT", json: v });
      toast.success(`${meta.name}: update settings saved`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <meta.icon className="size-5" aria-hidden="true" /> {meta.name}
        </CardTitle>
        <span className="text-xs text-muted-foreground">{r.updatedAt ? `Saved ${time.dateTime(r.updatedAt)}` : "Not set yet"}</span>
      </CardHeader>
      <form onSubmit={save} className="grid gap-4 px-4 pb-4 pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${r.platform}-latest`} label="Latest version" description="Older apps see “Update available” (they can choose Later).">
            <Input id={`${r.platform}-latest`} inputMode="decimal" placeholder="1.3.0" value={v.latestVersion} onChange={(e) => set("latestVersion", e.target.value.trim())} />
          </Field>
          <Field id={`${r.platform}-min`} label="Required version" description="Older apps must update before they can be used.">
            <Input id={`${r.platform}-min`} inputMode="decimal" placeholder="1.2.0" value={v.minVersion} onChange={(e) => set("minVersion", e.target.value.trim())} />
          </Field>
        </div>
        <Field id={`${r.platform}-url`} label="Update link" description={`Store page, or a direct download link while the app isn't in the store. Example: ${meta.store}`}>
          <Input id={`${r.platform}-url`} type="url" placeholder="https://" value={v.updateUrl} onChange={(e) => set("updateUrl", e.target.value.trim())} />
        </Field>
        <Field id={`${r.platform}-notes`} label="What's new (optional)" description="One or two short lines, shown on the update screen.">
          <Textarea id={`${r.platform}-notes`} rows={2} maxLength={500} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        {raisingMin && (
          <Alert tone="warning" title={`Apps older than ${v.minVersion} will stop working until updated`}>
            Make sure version {v.minVersion} or newer is already live in the store, or people won&apos;t be able to update.
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex items-center justify-between gap-3">
          {v.updateUrl ? (
            <a href={v.updateUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary">
              <Download className="size-4" aria-hidden="true" /> Test the link
            </a>
          ) : (
            <span />
          )}
          <Button type="submit" loading={busy} disabled={!dirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
