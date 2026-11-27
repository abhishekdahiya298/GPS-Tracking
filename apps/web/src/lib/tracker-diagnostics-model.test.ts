import { describe, expect, it } from "vitest";
import { checkConfig, commandPayload, healthChecks, hourlyBuckets, overallVerdict, parseParams, parseReply, toDiagReport, TrackerCommandSchema, type DiagReport } from "./tracker-diagnostics-model";

const now = Date.parse("2026-11-26T18:50:00Z");
const raw = (over: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) => ({
  deviceTime: "2026-11-26T18:49:01Z",
  fixTime: "2026-11-26T18:49:01Z",
  serverTime: "2026-11-26T18:49:03Z",
  valid: true,
  latitude: 41.6562,
  longitude: -81.2792,
  speed: 57.2,
  course: 239,
  protocol: "teltonika",
  attributes: { sat: 27, hdop: 0.5, io69: 1, power: 14.3, battery: 3.99, ignition: true, motion: true, rssi: 5, ...attrs },
  ...over
});
const report = (o: Record<string, unknown> = {}, a: Record<string, unknown> = {}) => toDiagReport(raw(o, a)) as DiagReport;

describe("toDiagReport", () => {
  it("reads Traccar's Teltonika attributes and converts knots to km/h", () => {
    const r = report();
    expect(r).toMatchObject({ fix: true, satellites: 27, hdop: 0.5, gnssState: 1, externalV: 14.3, batteryV: 3.99, ignition: true, motion: true, signal: 5, protocol: "teltonika" });
    expect(r.speedKph).toBeCloseTo(105.9, 1);
  });
  it("treats invalid or 0,0 positions as no fix and keeps command replies", () => {
    expect(report({ valid: false }).fix).toBe(false);
    expect(report({ latitude: 0, longitude: 0 }).fix).toBe(false);
    expect(report({}, { result: " GPS:0 Sat:0 " }).result).toBe("GPS:0 Sat:0");
  });
  it("leaves missing sensors as null and rejects non-positions", () => {
    const r = toDiagReport({ deviceTime: "2026-11-26T18:49:01Z", attributes: {} })!;
    expect(r).toMatchObject({ satellites: null, externalV: null, batteryV: null, signal: null, fix: false });
    expect(toDiagReport("nope")).toBeNull();
    expect(toDiagReport({ attributes: {} })).toBeNull();
  });
});

describe("parseReply", () => {
  it("splits Teltonika Key:Value replies", () => {
    expect(parseReply("GPS:0 POWER:1 Sat:0 LAT:0 LON:0 Date:1970-01-01")).toEqual([
      { key: "GPS", value: "0" },
      { key: "POWER", value: "1" },
      { key: "Sat", value: "0" },
      { key: "LAT", value: "0" },
      { key: "LON", value: "0" },
      { key: "Date", value: "1970-01-01" }
    ]);
    expect(parseReply("BatState: n/a ExtV: 156 BatV: 4041")).toEqual([
      { key: "BatState", value: "n/a" },
      { key: "ExtV", value: "156" },
      { key: "BatV", value: "4041" }
    ]);
  });
});

describe("hourlyBuckets", () => {
  it("counts reports and fixes per hour and keeps the extremes", () => {
    const rs = [report({ deviceTime: "2026-11-26T16:10:00Z" }), report({ deviceTime: "2026-11-26T16:40:00Z", valid: false }, { sat: 0, power: 0.2 }), report({ deviceTime: "2026-11-26T18:05:00Z" })];
    const b = hourlyBuckets(rs, new Date("2026-11-26T16:00:00Z"), new Date("2026-11-26T19:00:00Z"));
    expect(b).toHaveLength(3);
    expect(b[0]).toMatchObject({ reports: 2, fixes: 1, maxSatellites: 27, minExternalV: 0.2 });
    expect(b[1]).toMatchObject({ reports: 0, fixes: 0, maxSatellites: null });
    expect(b[2]).toMatchObject({ reports: 1, fixes: 1 });
  });
});

describe("health checks", () => {
  const base = { now, offlineSeconds: 3900 };
  it("a healthy truck (TRUCK-202 on 2026-11-26) is all green", () => {
    const checks = healthChecks({ ...base, lastSeenAt: "2026-11-26T18:49:03Z", lastFixAt: "2026-11-26T18:49:01Z", reports: [report()] });
    expect(checks.map((c) => c.level)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(overallVerdict(checks).title).toBe("Healthy");
  });

  it("TRAILER-203: online, 0 satellites while moving, no vehicle power", () => {
    const r = report({ valid: false, latitude: 0, longitude: 0, speed: 0 }, { sat: 0, io69: 2, hdop: 100, power: 0.156, battery: 4.04, ignition: false, motion: true, rssi: 2 });
    const checks = healthChecks({ ...base, lastSeenAt: "2026-11-26T18:49:03Z", lastFixAt: "2026-11-22T23:00:00Z", reports: [r] });
    const by = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(by.connection!.level).toBe("ok");
    expect(by.gps!.level).toBe("bad");
    expect(by.gps!.value).toBe("0 satellites");
    expect(by.gps!.detail).toContain("while the vehicle is moving");
    expect(by.gps!.detail).toContain("3 d 19 h");
    expect(by.power!.level).toBe("warn");
    expect(by.battery!.level).toBe("ok");
    const v = overallVerdict(checks);
    expect(v.level).toBe("bad");
    expect(v.title).toBe("Needs attention: GPS");
  });

  it("a silent tracker (TRUCK-203) shows the connection as the problem", () => {
    const checks = healthChecks({ ...base, lastSeenAt: "2026-11-22T18:38:41Z", lastFixAt: "2026-11-22T18:38:32Z", reports: [] });
    expect(checks[0]).toMatchObject({ level: "bad", value: "4 d 0 h ago" });
    expect(checks[1]!.level).toBe("unknown");
    expect(overallVerdict(checks).title).toBe("Needs attention: Connection");
  });

  it("flags a low internal battery and weak signal", () => {
    const checks = healthChecks({ ...base, lastSeenAt: "2026-11-26T18:49:03Z", lastFixAt: "2026-11-26T18:49:01Z", reports: [report({}, { battery: 3.4, rssi: 1 })] });
    expect(checks.find((c) => c.id === "battery")!.level).toBe("bad");
    expect(checks.find((c) => c.id === "signal")!.level).toBe("warn");
  });
});

describe("command allowlist", () => {
  it("accepts only allowlisted commands, never a setting change", () => {
    expect(TrackerCommandSchema.safeParse({ command: "getgps" }).success).toBe(true);
    expect(TrackerCommandSchema.safeParse({ command: "cpureset" }).success).toBe(true);
    expect(TrackerCommandSchema.safeParse({ command: "setparam 2004:evil.example" }).success).toBe(false);
    expect(TrackerCommandSchema.safeParse({ command: "deleterecords" }).success).toBe(false);
    expect(TrackerCommandSchema.safeParse({ command: "getparam 2001" }).success).toBe(false);
  });
});

describe("settings check (getparam)", () => {
  it("reads the FTM880 mixed format (label on the first value only)", () => {
    const real = "Param ID:2001 Value:hologram;2004:tracker.riogps.com;2005:5027;2006:0;2010:0;107:2;102:3;103:10;110:0;10050:60;10051:400;10052:15;10055:30;10000:14400";
    expect(Object.keys(parseParams(real))).toHaveLength(14);
    expect(checkConfig(real, false)!.every((r) => r.ok)).toBe(true);
    const v1 = "Param ID:2001 Value:hologram;2004:tracker.riogps.com;2005:5027;2006:0;2010:0;107:1;102:3;103:20;110:2;10050:10;10051:1000;10052:25;10055:120;10000:3600";
    const rows = checkConfig(v1, false)!;
    expect(rows.filter((r) => r.severity === "critical" && !r.ok)).toHaveLength(0);
    expect(rows.find((r) => r.id === "110")!.actual).toBe("Always");
  });
  it("reads both Teltonika reply formats", () => {
    expect(parseParams("Param ID:2001 Value:hologram Param ID:2005 Value:5027")).toEqual({ "2001": "hologram", "2005": "5027" });
    expect(parseParams("2001:hologram;2004:tracker.riogps.com;2005:5027")).toEqual({ "2001": "hologram", "2004": "tracker.riogps.com", "2005": "5027" });
  });
  it("flags a tracker that can't reach RIO (the broken v1.cfg case)", () => {
    const rows = checkConfig("2001:;2004:;2005:0;2006:0", false)!;
    expect(rows.filter((r) => r.severity === "critical" && !r.ok).map((r) => r.label)).toEqual(["APN", "Server", "Port"]);
  });
  it("passes the v2 truck config and shows words", () => {
    const rows = checkConfig("2001:hologram;2004:tracker.riogps.com;2005:5027;2006:0;2010:0;107:2;102:3;103:10;110:0;10050:60;10051:400;10052:15;10055:30;10000:14400", false)!;
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.find((r) => r.id === "102")!.actual).toBe("Online sleep");
  });
  it("uses the trailer standard for trailers", () => {
    const rows = checkConfig("103:10;10055:30", true)!;
    expect(rows.find((r) => r.id === "103")!.ok).toBe(false);
  });
  it("is null for replies that aren't settings", () => expect(checkConfig("GPS:1 Sat:10", false)).toBeNull());
  it("maps command ids to what is sent", () => {
    expect(commandPayload("getgps")).toBe("getgps");
    expect(commandPayload("checkconfig")).toMatch(/^getparam 2001;2004;2005/);
    expect(commandPayload("checkconfig").length).toBeLessThanOrEqual(160);
  });
});

describe("external power from FT-platform trackers", () => {
  it("reads io800 (mV) when Traccar has no power attribute", () => {
    const r = toDiagReport({ fixTime: "2026-11-27T10:00:00Z", serverTime: "2026-11-27T10:00:01Z", valid: true, latitude: 1, longitude: 1, attributes: { io800: 13650 } })!;
    expect(r.externalV).toBe(13.65);
  });
});
