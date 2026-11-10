import { useEffect, useMemo, useRef, useState } from "react";
import type { FleetDevice } from "@/fleet/model";
import { bearing, lerpLngLat, nextTrails, positionOf, shouldAnimate, toFeatures, trailFeatures } from "./model";

/** How long a vehicle takes to slide to its new position. */
const GLIDE_MS = 900;
/** Redraw rate while anything is sliding. 20 a second looks smooth and stays cheap. */
const FRAME_MS = 50;
/** With more vehicles than this moving at once, skip the slide and jump (keeps big fleets fast). */
const MAX_GLIDING = 120;

interface Glide {
  from: [number, number];
  to: [number, number];
  start: number;
}

/**
 * Turns the fleet into what the map draws: vehicles that slide between reports instead of
 * jumping, and a short trail behind each moving one. Display only; GPS data is not changed.
 */
export function useGlide(devices: FleetDevice[], fmtSpeed: (kph: number | null) => string) {
  const shown = useRef(new Map<string, [number, number]>());
  const glides = useRef(new Map<string, Glide>());
  const headings = useRef(new Map<string, number>());
  const trails = useRef(new Map<string, Array<[number, number]>>());
  const [frame, setFrame] = useState(0);

  // New data: decide per vehicle whether to slide or jump, and extend the trails.
  useEffect(() => {
    const now = Date.now();
    const ids = new Set<string>();
    for (const d of devices) {
      const target = positionOf(d);
      if (!target) continue;
      ids.add(d.deviceId);
      const at = shown.current.get(d.deviceId);
      if (at && shouldAnimate(at, target) && glides.current.size < MAX_GLIDING) {
        glides.current.set(d.deviceId, { from: at, to: target, start: now });
        headings.current.set(d.deviceId, bearing(at, target));
      } else if (!at || at[0] !== target[0] || at[1] !== target[1]) {
        glides.current.delete(d.deviceId);
        shown.current.set(d.deviceId, target);
      }
    }
    for (const id of [...shown.current.keys()]) {
      if (!ids.has(id)) {
        shown.current.delete(id);
        glides.current.delete(id);
        headings.current.delete(id);
      }
    }
    trails.current = nextTrails(trails.current, devices);
    setFrame((f) => f + 1);
  }, [devices]);

  // While anything is sliding, step it forward on a timer; stop the timer when all have arrived.
  const gliding = glides.current.size > 0;
  useEffect(() => {
    if (!gliding) return;
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [id, g] of glides.current) {
        const t = (now - g.start) / GLIDE_MS;
        shown.current.set(id, lerpLngLat(g.from, g.to, t));
        if (t >= 1) glides.current.delete(id);
      }
      setFrame((f) => f + 1);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [gliding]);

  return useMemo(
    () => {
      void frame; // changes on every step of a slide: that is what redraws the map
      return { vehicles: toFeatures(devices, fmtSpeed, shown.current, headings.current), trails: trailFeatures(trails.current, shown.current) };
    },
    [devices, fmtSpeed, frame]
  );
}
