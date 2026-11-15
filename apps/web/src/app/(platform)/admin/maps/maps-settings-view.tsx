"use client";
import { Check, Globe2, KeyRound, MapPinned, Moon, Sun, Map as MapIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { AddressProvider, MapsSettings, MapStyleChoice } from "@/lib/maps-settings";
import { cn } from "@/lib/cn";

const PROVIDERS: ReadonlyArray<{ value: AddressProvider; name: string; cost: string; text: string }> = [
  { value: "off", name: "Off", cost: "Free", text: "Screens show GPS coordinates only." },
  { value: "osm", name: "OpenStreetMap", cost: "Free", text: "Good street addresses in the US and Canada. Shared limit of 1 new spot per second, so best for small and medium fleets." },
  { value: "geoapify", name: "Geoapify", cost: "Free up to 3,000 new spots a day, then paid", text: "OpenStreetMap data with higher limits. Needs RIO_GEOAPIFY_KEY on the server." },
  { value: "google", name: "Google Maps", cost: "Paid after Google's monthly free credit", text: "The most complete addresses. Needs RIO_GOOGLE_MAPS_KEY on the server." }
];

const STYLES: ReadonlyArray<{ value: MapStyleChoice; name: string; icon: typeof Sun }> = [
  { value: "streets", name: "Streets", icon: MapIcon },
  { value: "light", name: "Light", icon: Sun },
  { value: "dark", name: "Dark", icon: Moon }
];

/** Platform console → Maps & addresses. Applies to every customer, in the app and on the website. */
export function MapsSettingsView({ initial, keys }: { initial: MapsSettings; keys: Record<AddressProvider, boolean> }) {
  const router = useRouter();
  const [v, setV] = useState<MapsSettings>(initial);
  const [busy, setBusy] = useState(false);
  const dirty = v.addressProvider !== initial.addressProvider || v.mapStyle !== initial.mapStyle;

  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/maps", { method: "PUT", json: v });
      toast.success("Maps settings saved. Customers see them within a minute.");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Maps & addresses" description="Choose how tracker positions become street addresses, and the map customers start with. Applies to the website and the phone app." />
      <div className="mb-4">
        <Alert tone="info" title="How addresses work">
          The server looks each spot up once and remembers it for 90 days, so a parked truck costs one lookup, not one per refresh. Service keys stay on the server and never reach a phone or browser. If the service is down or over its limit, screens show the coordinates instead.
        </Alert>
      </div>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <MapPinned className="size-4" aria-hidden="true" /> Address service
            </CardTitle>
          </CardHeader>
          <div role="radiogroup" aria-label="Address service" className="grid gap-2 p-4 sm:grid-cols-2">
            {PROVIDERS.map((p) => {
              const on = v.addressProvider === p.value;
              const ready = keys[p.value];
              return (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!ready}
                  onClick={() => setV((s) => ({ ...s, addressProvider: p.value }))}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-lg border-2 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    on ? "border-primary bg-primary-soft" : "border-border bg-background hover:border-input"
                  )}
                >
                  <span className="flex items-center gap-2">
                    {p.value === "off" ? <Globe2 className="size-4 text-muted-foreground" aria-hidden="true" /> : <MapPinned className="size-4 text-primary" aria-hidden="true" />}
                    <span className="flex-1 font-semibold">{p.name}</span>
                    {on && <Check className="size-4 text-primary" aria-hidden="true" />}
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">{p.cost}</span>
                  <span className="text-sm text-muted-foreground">{p.text}</span>
                  {!ready && (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-warning">
                      <KeyRound className="size-3.5" aria-hidden="true" /> Key not set on the server
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <MapIcon className="size-4" aria-hidden="true" /> Map customers start with
            </CardTitle>
          </CardHeader>
          <div className="grid gap-3 p-4">
            <div role="radiogroup" aria-label="Default map look" className="grid grid-cols-3 gap-2 sm:max-w-md">
              {STYLES.map((st) => {
                const on = v.mapStyle === st.value;
                return (
                  <button
                    key={st.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setV((s) => ({ ...s, mapStyle: st.value }))}
                    className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 p-3 text-sm font-semibold", on ? "border-primary bg-primary-soft text-primary" : "border-border bg-background text-muted-foreground hover:border-input")}
                  >
                    <st.icon className="size-5" aria-hidden="true" />
                    {st.name}
                  </button>
                );
              })}
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              Maps are drawn from OpenStreetMap through OpenFreeMap: free, no key, no usage limit. On phones, the Navigate button opens Apple Maps on iPhone and Google Maps on Android for turn-by-turn directions, also free.
            </p>
          </div>
        </Card>
        <div className="flex justify-end">
          <Button onClick={save} disabled={!dirty || busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </>
  );
}
