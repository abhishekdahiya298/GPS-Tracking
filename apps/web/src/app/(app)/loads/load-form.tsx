"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { circleRing } from "@rio-gps/core/geo";
import { LOAD_RADIUS_DEFAULT_M } from "@rio-gps/core/loads";
import { toWallTime, wallTimeToUtc } from "@rio-gps/core/timezones";
import { Check, Copy, MapPin, Search } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from "maplibre-gl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTime } from "@/components/app/time-context";
import { useUnits } from "@/components/app/units-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { api, errorMessage } from "@/lib/client/api";
import type { GeocodeResult } from "@/lib/geocode";
import type { LoadDetailDto } from "@/lib/loads";
import type { SmsResult } from "@/lib/sms";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const RADII = [250, 500, 1_000, 2_000, 5_000];

interface StopState {
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  /** datetime-local value in the organization's zone, or "". */
  appointment: string;
}

const emptyStop = (): StopState => ({ name: "", address: "", latitude: null, longitude: null, radiusM: LOAD_RADIUS_DEFAULT_M, appointment: "" });

/** Small map: click to place the stop, drag the pin to adjust; shows the arrival circle. */
function StopMap({ stop, color, onMove }: { stop: StopState; color: string; onMove: (lat: number, lon: number) => void }) {
  const div = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const [loaded, setLoaded] = useState(false);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    if (!div.current || map.current) return;
    const m = new maplibregl.Map({ container: div.current, style: STYLE_URL, center: [stop.longitude ?? -79.38, stop.latitude ?? 43.65], zoom: stop.latitude !== null ? 13 : 3, attributionControl: { compact: true } });
    m.getCanvas().setAttribute("aria-label", "Stop location. Search for the address above; click the map to adjust.");
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: false }), "top-right");
    m.on("styleimagemissing", (e) => {
      if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    m.on("load", () => {
      m.addSource("circle", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({ id: "circle-fill", type: "fill", source: "circle", paint: { "fill-color": color, "fill-opacity": 0.15 } });
      m.addLayer({ id: "circle-line", type: "line", source: "circle", paint: { "line-color": color, "line-width": 1.5 } });
      setLoaded(true);
    });
    m.on("click", (e) => move.current(e.lngLat.lat, e.lngLat.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const src = m.getSource("circle") as GeoJSONSource;
    if (stop.latitude === null || stop.longitude === null) {
      src.setData({ type: "FeatureCollection", features: [] });
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const ll: [number, number] = [stop.longitude, stop.latitude];
    src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(ll, stop.radiusM)] } }] });
    if (!marker.current) {
      marker.current = new maplibregl.Marker({ color, draggable: true }).setLngLat(ll).addTo(m);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLngLat();
        move.current(p.lat, p.lng);
      });
    } else marker.current.setLngLat(ll);
  }, [loaded, stop.latitude, stop.longitude, stop.radiusM, color]);

  // Recentre when a search result is picked (not on every drag).
  const lastCentered = useRef<string>("");
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || stop.latitude === null || stop.longitude === null) return;
    const key = stop.address;
    if (lastCentered.current === key) return;
    lastCentered.current = key;
    m.easeTo({ center: [stop.longitude, stop.latitude], zoom: Math.max(m.getZoom(), 13), duration: 400 });
  }, [loaded, stop.address, stop.latitude, stop.longitude]);

  return <div ref={div} className="h-48 w-full overflow-hidden rounded-lg border border-border" />;
}

function StopFields({ id, title, color, stop, onChange, error }: { id: string; title: string; color: string; stop: StopState; onChange: (s: StopState) => void; error: string | null }) {
  const u = useUnits();
  const t = useTime();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const fmtRadius = (m: number) => (u.system === "imperial" ? (m < 1609 ? `${Math.round((m * 3.28084) / 50) * 50} ft` : `${(m / 1609.344).toFixed(1)} mi`) : m < 1000 ? `${m} m` : `${m / 1000} km`);

  async function search() {
    const q = query.trim();
    if (q.length < 3) return;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await api<{ results: GeocodeResult[] }>(`/api/geocode?q=${encodeURIComponent(q)}`);
      setResults(r.results);
      if (r.results.length === 1) pick(r.results[0]!);
    } catch (err) {
      setSearchError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  }
  function pick(r: GeocodeResult) {
    onChange({ ...stop, address: r.label, latitude: r.latitude, longitude: r.longitude });
    setResults(null);
    setQuery("");
  }

  return (
    <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0">
      <legend className="mb-1 flex items-center gap-2 p-0 text-sm font-semibold text-[#0a2463]">
        <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: color }} />
        {title}
      </legend>
      <Field id={`${id}-name`} label="Name" description="Shipper or receiver, e.g. Acme DC (optional).">
        <Input id={`${id}-name`} value={stop.name} maxLength={80} onChange={(e) => onChange({ ...stop, name: e.target.value })} />
      </Field>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-search`}>
          Address<span className="text-danger" aria-hidden="true"> *</span>
        </Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-search`}
            value={query}
            placeholder={stop.address ? "Search again to change…" : "Street, city, or 43.65, -79.38"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
            aria-invalid={Boolean(error) || undefined}
          />
          <Button variant="secondary" onClick={() => void search()} loading={searching} disabled={query.trim().length < 3}>
            <Search aria-hidden="true" /> Find
          </Button>
        </div>
        {searchError && <p className="m-0 text-xs text-danger">{searchError}</p>}
        {results && (
          <ul className="m-0 list-none overflow-hidden rounded-md border border-border p-0" aria-label="Address results">
            {results.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No match. Try adding the city, or type coordinates.</li>}
            {results.map((r) => (
              <li key={`${r.latitude},${r.longitude}`} className="border-b border-border last:border-b-0">
                <button type="button" onClick={() => pick(r)} className="flex w-full cursor-pointer items-start gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm hover:bg-muted">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {stop.address && (
          <p className="m-0 flex items-start gap-1.5 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>{stop.address}</span>
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <StopMap stop={stop} color={color} onMove={(lat, lon) => onChange({ ...stop, latitude: lat, longitude: lon, address: stop.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}` })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-radius`} label="Arrival area" description="Inside this circle counts as arrived.">
          <Select id={`${id}-radius`} value={stop.radiusM} onChange={(e) => onChange({ ...stop, radiusM: Number(e.target.value) })}>
            {RADII.map((r) => (
              <option key={r} value={r}>
                {fmtRadius(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`${id}-appt`} label={`Appointment (${t.abbr()})`} description="Used for on-time / late.">
          <Input id={`${id}-appt`} type="datetime-local" value={stop.appointment} onChange={(e) => onChange({ ...stop, appointment: e.target.value })} />
        </Field>
      </div>
    </fieldset>
  );
}

function CopyLink({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            toast.success("Link copied.");
          } catch {
            toast.error("Couldn't copy automatically. Select the link and copy it.");
          }
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
export { CopyLink };

/** What happened to the text message, in one line. */
export function SmsOutcome({ sms, smsAvailable }: { sms: SmsResult | null; smsAvailable: boolean }) {
  if (sms?.sent) return <Alert tone="success" title="Invite texted to the driver.">They tap the link and accept to start sharing their location.</Alert>;
  if (sms && !sms.sent) return <Alert tone="warning" title="The text was not sent.">{sms.message}</Alert>;
  return (
    <Alert tone="info" title="Send this link to the driver.">
      {smsAvailable ? "You chose not to text it." : "Text messages are not set up yet, so send it yourself (SMS, WhatsApp or email)."} It only works once the driver opens it and accepts.
    </Alert>
  );
}

export function LoadForm({ initial, smsAvailable }: { initial?: LoadDetailDto; smsAvailable: boolean }) {
  const router = useRouter();
  const t = useTime();
  const fromDto = (s: LoadDetailDto["pickup"]): StopState => ({ name: s.name ?? "", address: s.address, latitude: s.latitude, longitude: s.longitude, radiusM: s.radiusM, appointment: s.appointmentAt ? toWallTime(s.appointmentAt, t.timeZone) : "" });
  const [pickup, setPickup] = useState<StopState>(initial ? fromDto(initial.pickup) : emptyStop());
  const [delivery, setDelivery] = useState<StopState>(initial ? fromDto(initial.delivery) : emptyStop());
  const [sendInvite, setSendInvite] = useState(smsAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopErrors, setStopErrors] = useState<{ pickup: string | null; delivery: string | null }>({ pickup: null, delivery: null });
  const [created, setCreated] = useState<{ id: string; reference: string; driverLink: string; sms: SmsResult | null } | null>(null);

  const stopBody = (s: StopState) => ({
    name: s.name.trim() || null,
    address: s.address,
    latitude: s.latitude,
    longitude: s.longitude,
    radiusM: s.radiusM,
    appointmentAt: s.appointment ? wallTimeToUtc(s.appointment, t.timeZone).toISOString() : null
  });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const errs = {
      pickup: pickup.latitude === null ? "Find the pickup address or click its spot on the map." : null,
      delivery: delivery.latitude === null ? "Find the delivery address or click its spot on the map." : null
    };
    setStopErrors(errs);
    if (errs.pickup || errs.delivery) return;
    const body = {
      reference: String(f.get("reference") ?? "").trim(),
      carrierName: String(f.get("carrierName") ?? "").trim() || null,
      driverName: String(f.get("driverName") ?? "").trim() || null,
      driverPhone: String(f.get("driverPhone") ?? "").trim(),
      notes: String(f.get("notes") ?? "").trim() || null,
      pickup: stopBody(pickup),
      delivery: stopBody(delivery)
    };
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        await api(`/api/loads/${initial.id}`, { method: "PATCH", json: body });
        toast.success("Load saved.");
        router.push(`/loads/${initial.id}`);
        router.refresh();
      } else {
        const r = await api<{ id: string; driverLink: string; sms: SmsResult | null }>("/api/loads", { method: "POST", json: { ...body, sendInvite } });
        setCreated({ ...r, reference: body.reference });
        window.scrollTo({ top: 0 });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <div>
            <CardTitle>Load {created.reference} created</CardTitle>
            <CardDescription>The driver&apos;s link is shown only now. You can make a new one later from the load page.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <SmsOutcome sms={created.sms} smsAvailable={smsAvailable} />
          <CopyLink link={created.driverLink} label="Driver link" />
        </CardContent>
        <CardFooter>
          <Button variant="secondary" onClick={() => window.location.assign("/loads/new")}>
            Create another
          </Button>
          <Button asChild>
            <Link href={`/loads/${created.id}`}>Open load</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Load and driver</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field id="reference" label="Load number" required>
            <Input id="reference" name="reference" required maxLength={40} defaultValue={initial?.reference} placeholder="L-10432" autoFocus={!initial} />
          </Field>
          <Field id="carrierName" label="Carrier">
            <Input id="carrierName" name="carrierName" maxLength={120} defaultValue={initial?.carrierName ?? ""} />
          </Field>
          <Field id="driverName" label="Driver name">
            <Input id="driverName" name="driverName" maxLength={80} defaultValue={initial?.driverName ?? ""} autoComplete="off" />
          </Field>
          <Field id="driverPhone" label="Driver mobile" required description="The tracking link goes to this number.">
            <Input id="driverPhone" name="driverPhone" type="tel" required maxLength={30} defaultValue={initial?.driverPhone ?? ""} placeholder="(416) 555-0123" autoComplete="off" />
          </Field>
          <Field id="notes" label="Notes" className="sm:col-span-2" description="Only your team sees notes.">
            <Textarea id="notes" name="notes" maxLength={1000} defaultValue={initial?.notes ?? ""} rows={2} />
          </Field>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent>
            <StopFields id="pickup" title="Pickup" color="#0e7c66" stop={pickup} onChange={setPickup} error={stopErrors.pickup} />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <StopFields id="delivery" title="Delivery" color="#d81e2c" stop={delivery} onChange={setDelivery} error={stopErrors.delivery} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardFooter className="justify-between border-t-0">
          {initial ? (
            <span className="text-sm text-muted-foreground">Changes apply to tracking right away.</span>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={sendInvite} disabled={!smsAvailable} onChange={(e) => setSendInvite(e.target.checked)} />
              {smsAvailable ? "Text the tracking link to the driver now" : "Text messages are not set up: you'll copy the link and send it yourself"}
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href={initial ? `/loads/${initial.id}` : "/loads"}>Cancel</Link>
            </Button>
            <Button type="submit" loading={busy}>
              {initial ? "Save changes" : "Create load"}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
