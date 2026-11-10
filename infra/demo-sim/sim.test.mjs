// node --test infra/demo-sim/sim.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { avlPacket, crc16, imeiPacket, measure, pointAt, routeState } from "./sim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Independent Codec 8E decoder (written from the Teltonika spec, not from the encoder). */
function decode(buf) {
  assert.equal(buf.readUInt32BE(0), 0, "preamble");
  const len = buf.readUInt32BE(4);
  const body = buf.subarray(8, 8 + len);
  assert.equal(buf.readUInt32BE(8 + len), crc16(body), "crc");
  let o = 0;
  const codec = body[o++];
  const n = body[o++];
  const recs = [];
  for (let r = 0; r < n; r++) {
    const rec = { time: Number(body.readBigUInt64BE(o)) }; o += 8;
    rec.priority = body[o++];
    rec.lon = body.readInt32BE(o) / 1e7; o += 4;
    rec.lat = body.readInt32BE(o) / 1e7; o += 4;
    rec.alt = body.readInt16BE(o); o += 2;
    rec.angle = body.readUInt16BE(o); o += 2;
    rec.sats = body[o++];
    rec.speed = body.readUInt16BE(o); o += 2;
    rec.eventId = body.readUInt16BE(o); o += 2;
    const total = body.readUInt16BE(o); o += 2;
    rec.io = {};
    let seen = 0;
    for (const size of [1, 2, 4, 8]) {
      const c = body.readUInt16BE(o); o += 2;
      for (let i = 0; i < c; i++) {
        const id = body.readUInt16BE(o); o += 2;
        rec.io[id] = size === 1 ? body[o] : size === 2 ? body.readUInt16BE(o) : size === 4 ? body.readUInt32BE(o) : Number(body.readBigUInt64BE(o));
        o += size;
        seen++;
      }
    }
    const nx = body.readUInt16BE(o); o += 2;
    assert.equal(nx, 0);
    assert.equal(seen, total, "IO total count");
    recs.push(rec);
  }
  assert.equal(body[o++], n, "trailing record count");
  assert.equal(o, body.length, "no trailing bytes");
  return { codec, recs };
}

test("CRC-16/IBM matches the standard check value", () => {
  assert.equal(crc16(Buffer.from("123456789", "ascii")), 0xbb3d);
});

test("IMEI login packet", () => {
  const b = imeiPacket("359990000001015");
  assert.equal(b.readUInt16BE(0), 15);
  assert.equal(b.subarray(2).toString("ascii"), "359990000001015");
});

test("AVL packet round-trips through an independent decoder", () => {
  const t = new Date("2026-11-10T06:00:00Z");
  const pkt = avlPacket([
    {
      time: t, lat: 43.123456, lon: -79.654321, alt: 175, angle: 212, sats: 12, speed: 97,
      io: { 239: { bytes: 1, value: 1 }, 240: { bytes: 1, value: 1 }, 66: { bytes: 2, value: 14100 }, 16: { bytes: 4, value: 123456789 } },
    },
  ]);
  const { codec, recs } = decode(pkt);
  assert.equal(codec, 0x8e);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.time, t.getTime());
  assert.equal(r.lat, 43.123456);
  assert.equal(r.lon, -79.654321);
  assert.equal(r.angle, 212);
  assert.equal(r.speed, 97);
  assert.deepEqual(r.io, { 239: 1, 240: 1, 66: 14100, 16: 123456789 });
});

test("route state: moves along the line, rests at the ends, heading flips on the way back", () => {
  const coords = [[-79.0, 43.0], [-79.0, 43.1]]; // ~11.1 km due north
  const cum = measure(coords);
  const unit = { speedKmh: 100, restMin: 10, offsetMin: 0 };
  const driveS = cum[1] / (100 / 3.6);
  const a = routeState(unit, coords, cum, (driveS / 2) * 1000);
  assert.ok(a.moving && a.speed > 80 && Math.abs(a.lat - 43.05) < 0.001, "cruising mid-route");
  const start = routeState(unit, coords, cum, 30_000);
  assert.ok(start.moving && start.speed < 50, "slow near the yard");
  assert.ok(a.angle < 1 || a.angle > 359, "heading north");
  const rest = routeState(unit, coords, cum, (driveS + 60) * 1000);
  assert.equal(rest.moving, false);
  assert.equal(rest.speed, 0);
  assert.ok(Math.abs(rest.lat - 43.1) < 1e-6);
  const back = routeState(unit, coords, cum, (driveS + 600 + 120) * 1000);
  assert.ok(back.moving && Math.abs(back.angle - 180) < 1, "heading south on the way back");
  const p = pointAt(coords, cum, cum[1] / 2);
  assert.ok(Math.abs(p.lat - 43.05) < 1e-6);
});

test("units.json: unique IMEIs that pass the check digit", () => {
  const { units } = JSON.parse(fs.readFileSync(path.join(HERE, "units.json"), "utf8"));
  const luhn = (s) => [...s].reverse().reduce((sum, ch, i) => { let d = Number(ch); if (i % 2) { d *= 2; if (d > 9) d -= 9; } return sum + d; }, 0) % 10 === 0;
  assert.equal(new Set(units.map((u) => u.imei)).size, units.length);
  for (const u of units) {
    assert.match(u.imei, /^\d{15}$/);
    assert.ok(luhn(u.imei), `${u.imei} check digit`);
  }
});

test("end to end against a mock tracker server: login, ACK, AVL record", async () => {
  const got = [];
  const server = net.createServer((s) => {
    let logged = false;
    let buf = Buffer.alloc(0);
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!logged && buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        const len = buf.readUInt16BE(0);
        got.push({ imei: buf.subarray(2, 2 + len).toString("ascii") });
        buf = buf.subarray(2 + len);
        logged = true;
        s.write(Buffer.from([0x01]));
      }
      if (logged && buf.length >= 8 && buf.length >= 12 + buf.readUInt32BE(4)) {
        const pkt = buf.subarray(0, 12 + buf.readUInt32BE(4));
        const { recs } = decode(pkt);
        got[got.length - 1].recs = recs;
        const ack = Buffer.alloc(4); ack.writeUInt32BE(recs.length); s.write(ack);
        buf = buf.subarray(pkt.length);
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-"));
  const cfg = path.join(dir, "units.json");
  fs.writeFileSync(cfg, JSON.stringify({ units: [
    { imei: "359990000001056", name: "idle", kind: "idle", lat: 42.9, lon: -78.9 },
    { imei: "359990000001064", name: "parked", kind: "trailer-parked", lat: 43.7, lon: -79.7 },
  ] }));
  const child = spawn(process.execPath, [path.join(HERE, "sim.mjs"), "--host", "127.0.0.1", "--port", String(port), "--config", cfg, "--once"], { stdio: "pipe" });
  const code = await new Promise((r) => child.on("exit", r));
  server.close();
  assert.equal(code, 0);
  assert.deepEqual(got.map((g) => g.imei).sort(), ["359990000001056", "359990000001064"]);
  const idle = got.find((g) => g.imei === "359990000001056").recs[0];
  assert.equal(idle.io[239], 1, "idle truck: ignition on");
  assert.equal(idle.io[240], 0, "idle truck: not moving");
  const parked = got.find((g) => g.imei === "359990000001064").recs[0];
  assert.equal(parked.io[239], 0);
  assert.equal(parked.io[66], 0, "unhooked trailer: no external power");
  assert.ok(Math.abs(parked.lat - 43.7) < 1e-6);
});
