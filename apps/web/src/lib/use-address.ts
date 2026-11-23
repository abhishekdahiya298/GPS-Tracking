"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export interface StreetAddress {
  line1: string;
  line2: string | null;
  label: string;
}

/** loading: still asking · found: address known · none: no address for this spot · off: addresses are turned off. */
export type AddressState = "loading" | "found" | "none" | "off";
type Answer = {
  address: StreetAddress | null;
  state: AddressState;
  approximate: boolean;
};
type Reply = {
  address: StreetAddress | null;
  provider?: string;
  approximate?: boolean;
  retryAfter?: number;
};

const memo = new Map<string, Answer>();
const inflight = new Map<string, Promise<Answer>>();
const RETRY_STEPS = [3, 8, 20, 45, 90];

function ask(key: string): Promise<Answer> {
  const running = inflight.get(key);
  if (running) return running;
  const [la, lo] = key.split(",");
  const p = api<Reply>(`/api/geocode/reverse?lat=${la}&lon=${lo}`)
    .then((r): Answer => ({
      address: r.address,
      state: r.address
        ? "found"
        : r.provider === "off"
          ? "off"
          : r.retryAfter
            ? "loading"
            : "none",
      approximate: Boolean(r.approximate),
    }))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Street address for a position, with its state, from the server (Maps & addresses in the platform console).
 * Rounded to ~11 m (~110 m while moving) and remembered for the page's life. When the address
 * service is busy the hook keeps asking (3 s, 8 s, 20 s…) so the screen ends up with an address, not
 * coordinates; a nearby cached address is shown meanwhile.
 */
export function useAddressState(
  lat: number | null,
  lon: number | null,
  moving = false,
): Answer {
  const digits = moving ? 3 : 4;
  const key =
    lat === null ||
    lon === null ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
      ? null
      : `${lat.toFixed(digits)},${lon.toFixed(digits)}`;
  const [value, setValue] = useState<Answer>(
    () =>
      (key && memo.get(key)) || {
        address: null,
        state: key ? "loading" : "none",
        approximate: false,
      },
  );
  useEffect(() => {
    if (!key) {
      setValue({ address: null, state: "none", approximate: false });
      return;
    }
    const known = memo.get(key);
    if (known) {
      setValue(known);
      if (!known.approximate) return;
    } else {
      setValue((v) =>
        v.address
          ? { ...v, approximate: true }
          : { address: null, state: "loading", approximate: false },
      );
    }
    let live = true;
    let attempt = 0;
    // Out of retries with nothing: stop showing "finding" (the screen falls back to coordinates).
    const giveUp = () =>
      setValue((v) =>
        v.address ? v : { address: null, state: "none", approximate: false },
      );
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      ask(key)
        .then((a) => {
          if (!live) return;
          if (a.address || a.state !== "loading") {
            memo.set(key, a);
            setValue(a);
          }
          // Busy, or only a nearby address so far: ask again a little later.
          if (
            (a.state === "loading" || a.approximate) &&
            attempt < RETRY_STEPS.length
          )
            timer = setTimeout(run, RETRY_STEPS[attempt++]! * 1000);
          else if (a.state === "loading") giveUp();
        })
        .catch(() => {
          if (!live) return;
          if (attempt < RETRY_STEPS.length)
            timer = setTimeout(run, RETRY_STEPS[attempt++]! * 1000);
          else giveUp();
        });
    };
    timer = setTimeout(run, known ? RETRY_STEPS[0]! * 1000 : 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return value;
}

/** Street address for a position, or null while unknown (see useAddressState for why). */
export function useAddress(
  lat: number | null,
  lon: number | null,
  moving = false,
): StreetAddress | null {
  return useAddressState(lat, lon, moving).address;
}

/** Coordinates as a last resort only (addresses turned off, or no address exists for the spot). */
export const coordsText = (lat: number, lon: number) =>
  `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

export const FINDING_ADDRESS = "Finding address…";

/**
 * Text for a place: the address (whole, first line, or town), "Finding address…" while it loads,
 * and coordinates only when addresses are off or none exists for the spot.
 */
export function placeText(
  a: Answer,
  lat: number,
  lon: number,
  form: "full" | "line1" | "town" = "full",
): string {
  if (a.address)
    return form === "line1"
      ? a.address.line1
      : form === "town"
        ? (a.address.line2 ?? a.address.line1)
        : [a.address.line1, a.address.line2].filter(Boolean).join(", ");
  if (a.state === "loading") return FINDING_ADDRESS;
  return coordsText(lat, lon);
}
