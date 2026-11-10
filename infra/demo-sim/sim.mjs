#!/usr/bin/env node
/**
 * RIO GPS demo fleet simulator.
 *
 * Pretends to be Teltonika trackers: each demo unit opens its own TCP
 * connection to the tracker port (5027), logs in with its IMEI and sends
 * Codec 8 Extended AVL records, exactly like an FTM880/FTM164. The data goes
 * through Traccar, the webhook, trips and alerts the same way real data does,
 * so the demo company looks and behaves like a live fleet (App Store review,
 * screenshots, sales demos).
 *
 * Only for the demo company: the IMEIs in units.json are made-up numbers that
 * pass the IMEI check digit, registered to the demo customer only.
 *
 * Usage:  node sim.mjs [--host 127.0.0.1] [--port 5027] [--config units.json]
 *         node sim.mjs --once      (send one record per unit, then exit)
 * No dependencies; Node 18+.
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Codec 8 Extended encoding

/** CRC-16/IBM (ARC), as used by Teltonika: poly 0xA001 reflected, init 0. */
export function crc16(buf) {
  let crc = 0;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

/** IMEI login packet: 2-byte length + ASCII IMEI. */
export function imeiPacket(imei) {
  const b = Buffer.alloc(2 + imei.length);
  b.writeUInt16BE(imei.length, 0);
  b.write(imei, 2, "ascii");
  return b;
}

/**
 * One AVL record (Codec 8E).
 * rec: { time: Date, lat, lon, alt, angle, sats, speed (km/h), eventId, io: { [id]: {bytes:1|2|4|8, value} } }
 */
export function encodeRecord(rec) {
  const groups = { 1: [], 2: [], 4: [], 8: [] };
  for (const [id, { bytes, value }] of Object.entries(rec.io ?? {})) groups[bytes].push([Number(id), value]);
  const ioCount = groups[1].length + groups[2].length + groups[4].length + groups[8].length;
  const parts = [];
  const head = Buffer.alloc(8 + 1 + 15 + 2 + 2);
  let o = 0;
  head.writeBigUInt64BE(BigInt(rec.time.getTime()), o); o += 8;
  head.writeUInt8(rec.priority ?? 0, o); o += 1;
  head.writeInt32BE(Math.round(rec.lon * 1e7), o); o += 4;
  head.writeInt32BE(Math.round(rec.lat * 1e7), o); o += 4;
  head.writeInt16BE(Math.round(rec.alt ?? 180), o); o += 2;
  head.writeUInt16BE(Math.round(((rec.angle ?? 0) % 360 + 360) % 360), o); o += 2;
  head.writeUInt8(rec.sats ?? 12, o); o += 1;
  head.writeUInt16BE(Math.max(0, Math.round(rec.speed ?? 0)), o); o += 2;
  head.writeUInt16BE(rec.eventId ?? 0, o); o += 2;
  head.writeUInt16BE(ioCount, o); o += 2;
  parts.push(head);
  for (const size of [1, 2, 4, 8]) {
    const g = groups[size];
    const b = Buffer.alloc(2 + g.length * (2 + size));
    let p = 0;
    b.writeUInt16BE(g.length, p); p += 2;
    for (const [id, v] of g) {
      b.writeUInt16BE(id, p); p += 2;
      if (size === 1) b.writeUInt8(v, p);
      else if (size === 2) b.writeUInt16BE(v, p);
      else if (size === 4) b.writeUInt32BE(v >>> 0, p);
      else b.writeBigUInt64BE(BigInt(v), p);
      p += size;
    }
    parts.push(b);
  }
  parts.push(Buffer.from([0, 0])); // NX (variable-length) elements: none
  return Buffer.concat(parts);
}

/** Full AVL data packet: preamble, length, codec 0x8E, records, count, CRC. */
export function avlPacket(records) {
  const body = Buffer.concat([Buffer.from([0x8e, records.length]), ...records.map(encodeRecord), Buffer.from([records.length])]);
  const out = Buffer.alloc(8 + body.length + 4);
  out.writeUInt32BE(0, 0);
  out.writeUInt32BE(body.length, 4);
  body.copy(out, 8);
  out.writeUInt32BE(crc16(body), 8 + body.length);
  return out;
}

// ---------------------------------------------------------------------------
// Geometry

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
export function distM(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Cumulative distances along a [lon,lat] polyline. */
export function measure(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distM(coords[i - 1], coords[i]));
  return cum;
}
/** Point and heading at distance d (m) along the line. */
export function pointAt(coords, cum, d) {
  const total = cum[cum.length - 1];
  const x = Math.max(0, Math.min(total, d));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < x) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (x - cum[i - 1]) / seg;
  const a = coords[i - 1];
  const b = coords[i];
  return { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, angle: bearing(a, b) };
}

// ---------------------------------------------------------------------------
// Routes (fetched once from OSRM, then cached next to this file)

async function loadRoute(unit, cacheDir) {
  const key = `${unit.from.join(",")}_${unit.to.join(",")}`.replace(/[^0-9.,_-]/g, "");
  const file = path.join(cacheDir, `route_${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const url = `https://router.project-osrm.org/route/v1/driving/${unit.from[1]},${unit.from[0]};${unit.to[1]},${unit.to[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { "user-agent": "rio-gps-demo-sim/1.0" } });
  if (!res.ok) throw new Error(`OSRM ${res.status} for ${unit.name}`);
  const j = await res.json();
  const coords = j.routes?.[0]?.geometry?.coordinates;
  if (!coords?.length) throw new Error(`OSRM returned no route for ${unit.name}`);
  fs.writeFileSync(file, JSON.stringify(coords));
  return coords;
}

// ---------------------------------------------------------------------------
// Unit behaviour

const IO = { ignition: 239, movement: 240, gsm: 21, extV: 66, batV: 67, odometer: 16 };
const ODO_EPOCH_MS = Date.UTC(2026, 10, 1);

/**
 * A driving unit goes A → B, rests at B (ignition off), drives back, rests at A, forever.
 * The cycle position comes from the wall clock, so every restart resumes where the
 * truck "should" be and units with different offsets are spread along their routes.
 */
export function routeState(unit, coords, cum, nowMs) {
  const total = cum[cum.length - 1];
  const cruise = (unit.speedKmh ?? 95) / 3.6; // m/s
  const driveS = total / cruise;
  const restS = (unit.restMin ?? 25) * 60;
  const cycleS = 2 * (driveS + restS);
  const t = ((nowMs / 1000 + (unit.offsetMin ?? 0) * 60) % cycleS + cycleS) % cycleS;
  let dir;
  let along;
  let moving;
  if (t < driveS) { dir = 1; along = t * cruise; moving = true; }
  else if (t < driveS + restS) { dir = 1; along = total; moving = false; }
  else if (t < 2 * driveS + restS) { dir = -1; along = total - (t - driveS - restS) * cruise; moving = true; }
  else { dir = -1; along = 0; moving = false; }
  const p = pointAt(coords, cum, along);
  const angle = dir === 1 ? p.angle : (p.angle + 180) % 360;
  // Gentle speed variation so the speed chart is not a flat line; slow near the ends.
  const nearEnd = Math.min(along, total - along) < 3000;
  const wobble = 6 * Math.sin(nowMs / 97000 + (unit.offsetMin ?? 0));
  const speed = moving ? Math.max(8, (nearEnd ? 40 : unit.speedKmh ?? 95) + wobble) : 0;
  // Odometer: a realistic starting value plus the distance driven since 2026-11-01.
  const sinceS = Math.max(0, (nowMs - ODO_EPOCH_MS) / 1000);
  const cyclesSince = Math.floor(sinceS / cycleS);
  const inCycle = dir === 1 ? (t < driveS ? along : total) : total + (total - along);
  const odometer = Math.round(((unit.odometerKm ?? 250000) * 1000 + cyclesSince * 2 * total + inCycle) % 4e9);
  return { lat: p.lat, lon: p.lon, angle, speed, moving, odometer };
}

function record(unit, s, now) {
  const ign = s.ignition ?? s.moving;
  return {
    time: now,
    lat: s.lat,
    lon: s.lon,
    alt: 180,
    angle: s.angle ?? 0,
    sats: 11 + Math.floor(Math.random() * 4),
    speed: s.speed ?? 0,
    eventId: 0,
    io: {
      [IO.ignition]: { bytes: 1, value: ign ? 1 : 0 },
      [IO.movement]: { bytes: 1, value: s.moving ? 1 : 0 },
      [IO.gsm]: { bytes: 1, value: 4 },
      [IO.extV]: { bytes: 2, value: unit.kind === "trailer-parked" ? 0 : ign ? 13900 + Math.floor(Math.random() * 300) : 12600 },
      [IO.batV]: { bytes: 2, value: 4050 },
      [IO.odometer]: { bytes: 4, value: s.odometer ?? 0 },
    },
  };
}

function stateFor(unit, ctx, nowMs) {
  if (unit.kind === "route") return routeState(unit, ctx.coords, ctx.cum, nowMs);
  if (unit.kind === "idle") return { lat: unit.lat, lon: unit.lon, angle: unit.angle ?? 0, speed: 0, moving: false, ignition: true, odometer: unit.odometer ?? 0 };
  return { lat: unit.lat, lon: unit.lon, angle: unit.angle ?? 0, speed: 0, moving: false, ignition: false, odometer: unit.odometer ?? 0 };
}

/** Seconds until the next record: 30 s while moving, 5 min idling, 30 min parked. */
function intervalFor(unit, s) {
  if (s.moving) return unit.movingEverySec ?? 30;
  if (s.ignition ?? false) return 300;
  return unit.parkedEverySec ?? 1800;
}

// ---------------------------------------------------------------------------
// One TCP session per unit, reconnecting forever

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

function runUnit(unit, ctx, opts) {
  let sock = null;
  let ready = false;
  let timer = null;
  let backoff = 2000;

  const connect = () => {
    ready = false;
    sock = net.createConnection({ host: opts.host, port: opts.port });
    sock.setKeepAlive(true, 60000);
    sock.on("connect", () => sock.write(imeiPacket(unit.imei)));
    sock.on("data", (buf) => {
      if (!ready) {
        if (buf[0] === 0x01) {
          ready = true;
          backoff = 2000;
          log(`${unit.name}: logged in`);
          tick();
        } else {
          log(`${unit.name}: login refused (is IMEI ${unit.imei} registered in Traccar?)`);
          sock.destroy();
        }
      }
      // Later data = 4-byte record count ACKs; nothing to do.
    });
    sock.on("error", (e) => log(`${unit.name}: ${e.code ?? e.message}`));
    sock.on("close", () => {
      ready = false;
      clearTimeout(timer);
      if (opts.stopping) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60000);
    });
  };

  const tick = () => {
    if (!ready) return;
    const now = new Date();
    const s = stateFor(unit, ctx, now.getTime());
    sock.write(avlPacket([record(unit, s, now)]));
    if (opts.verbose) log(`${unit.name}: ${s.lat.toFixed(5)},${s.lon.toFixed(5)} ${Math.round(s.speed)} km/h ${s.moving ? "moving" : "stopped"}`);
    if (opts.once) {
      setTimeout(() => { opts.stopping = true; sock.end(); }, 1500);
      return;
    }
    timer = setTimeout(tick, intervalFor(unit, s) * 1000);
  };

  connect();
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { host: "127.0.0.1", port: 5027, config: path.join(HERE, "units.json"), once: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") o.host = argv[++i];
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--config") o.config = argv[++i];
    else if (a === "--once") o.once = true;
    else if (a === "--verbose" || a === "-v") o.verbose = true;
  }
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const units = JSON.parse(fs.readFileSync(opts.config, "utf8")).units;
  const cacheDir = process.env.SIM_CACHE_DIR ?? path.join(path.dirname(opts.config), "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  log(`demo-sim: ${units.length} units → ${opts.host}:${opts.port}`);
  for (const unit of units) {
    const ctx = {};
    if (unit.kind === "route") {
      ctx.coords = await loadRoute(unit, cacheDir);
      ctx.cum = measure(ctx.coords);
      log(`${unit.name}: route ${(ctx.cum[ctx.cum.length - 1] / 1000).toFixed(0)} km`);
    }
    runUnit(unit, ctx, opts);
    await new Promise((r) => setTimeout(r, 500)); // stagger logins
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
