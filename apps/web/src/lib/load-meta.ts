import type { LoadStatus } from "@rio-gps/core/loads";
import type { StatusTone } from "@/components/app/status-badge";

/** Labels for a load's status (broker, driver and shipper pages). Client-safe. */
export const LOAD_STATUS_META: Record<LoadStatus, { label: string; tone: StatusTone; shipperLabel: string }> = {
  invited: { label: "Waiting for driver", tone: "neutral", shipperLabel: "Scheduled" },
  tracking: { label: "Heading to pickup", tone: "info", shipperLabel: "Heading to pickup" },
  at_pickup: { label: "At pickup", tone: "primary", shipperLabel: "Loading at pickup" },
  in_transit: { label: "In transit", tone: "success", shipperLabel: "In transit" },
  at_delivery: { label: "At delivery", tone: "primary", shipperLabel: "Arrived at delivery" },
  delivered: { label: "Delivered", tone: "success", shipperLabel: "Delivered" },
  cancelled: { label: "Cancelled", tone: "neutral", shipperLabel: "Cancelled" },
  declined: { label: "Driver declined", tone: "danger", shipperLabel: "Not available" }
};

export const LOAD_EVENT_LABEL: Record<string, string> = {
  created: "Load created",
  invite_sent: "Invite texted to driver",
  accepted: "Driver accepted and started sharing",
  declined: "Driver declined",
  sharing_stopped: "Driver paused sharing",
  sharing_resumed: "Driver resumed sharing",
  arrived_pickup: "Arrived at pickup",
  departed_pickup: "Left pickup",
  arrived_delivery: "Arrived at delivery",
  departed_delivery: "Left delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  updated: "Load details edited"
};

/**
 * Short place for lists and headers: the stop's name, else "City, ST" from an address like
 * "100 Front Street West, Toronto, ON M5J 1E3, Canada" (or "Montréal, QC, Canada").
 */
export function shortPlace(name: string | null, address: string): string {
  if (name) return name;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return address;
  // "[street,] city, ST postcode, country": the city is third from the end.
  const city = parts[parts.length - 3]!;
  const region = parts[parts.length - 2]!.split(" ")[0]!;
  return region.length <= 3 ? `${city}, ${region}` : city;
}

export function fmtDistanceM(m: number, imperial: boolean): string {
  if (imperial) {
    const mi = m / 1609.344;
    return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi).toLocaleString()} mi`;
  }
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
}
