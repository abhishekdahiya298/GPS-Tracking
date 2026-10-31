import { describe, expect, it, vi } from "vitest";

// Server config for getServerEnv(), including Twilio, set before any module reads it.
vi.hoisted(() => {
  Object.assign(process.env, {
    RIO_DATABASE_URL: "postgres://u@localhost/x",
    REDIS_URL: "redis://localhost:1",
    TRACCAR_WEBHOOK_SECRET: "w".repeat(40),
    AUTH_SECRET: "a".repeat(40),
    AUTH_URL: "https://app.riogps.com",
    TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "t".repeat(32),
    TWILIO_FROM: "+15005550006"
  });
});

import { parseCoordinates } from "./geocode";
import { driverLink, inviteText, normalizePhone } from "./loads";
import { sendSms } from "./sms";

describe("normalizePhone", () => {
  it("accepts the usual ways of writing a North American number", () => {
    for (const v of ["(416) 555-0123", "416-555-0123", "416.555.0123", "4165550123", "1 416 555 0123", "+1 416 555 0123"]) expect(normalizePhone(v)).toBe("+14165550123");
  });
  it("keeps other countries in E.164 and rejects junk", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    for (const v of ["12345", "555-0123", "+0123456789", "phone", ""]) expect(normalizePhone(v)).toBeNull();
  });
});

describe("invite", () => {
  it("says who asks, for which load, how it ends and how to opt out, and fits two SMS segments", () => {
    const link = driverLink("A".repeat(43));
    expect(link).toBe(`https://app.riogps.com/d#${"A".repeat(43)}`);
    const text = inviteText("Northbound Brokerage", "L-10432", link);
    expect(text).toContain("Northbound Brokerage");
    expect(text).toContain("L-10432");
    expect(text).toContain("Reply STOP");
    expect(text.length).toBeLessThanOrEqual(306);
  });
});

describe("sendSms", () => {
  it("posts to Twilio with basic auth and reports success", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }));
    expect(await sendSms("+14165550123", "hi", fetchImpl as unknown as typeof fetch)).toEqual({ sent: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${"0".repeat(32)}/Messages.json`);
    expect(String(init.body)).toContain("To=%2B14165550123");
    expect(String(init.body)).toContain("From=%2B15005550006");
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
  });
  it("explains an opted-out driver and a dead service", async () => {
    const stop = vi.fn(async () => new Response(JSON.stringify({ code: 21610 }), { status: 400 }));
    expect(await sendSms("+14165550123", "hi", stop as unknown as typeof fetch)).toMatchObject({ sent: false, reason: "rejected", message: expect.stringContaining("STOP") });
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await sendSms("+14165550123", "hi", down as unknown as typeof fetch)).toMatchObject({ sent: false, reason: "unavailable" });
  });
});

describe("parseCoordinates", () => {
  it("answers typed coordinates without a lookup", () => {
    expect(parseCoordinates("43.6453, -79.3806")).toMatchObject({ latitude: 43.6453, longitude: -79.3806 });
    expect(parseCoordinates("95, 10")).toBeNull();
    expect(parseCoordinates("100 Front St")).toBeNull();
  });
});

import { cleanAddress } from "./geocode";
import { shortPlace } from "./load-meta";

describe("clean addresses and short places", () => {
  it("builds a postal-style address from Nominatim parts", () => {
    const toronto = cleanAddress({
      display_name: "Fairmont Royal York, 100, Front Street West, South Core, Spadina—Fort York, Toronto, Ontario, M5J 1E3, Canada",
      name: "Fairmont Royal York",
      address: { house_number: "100", road: "Front Street West", suburb: "South Core", city: "Toronto", state: "Ontario", "ISO3166-2-lvl4": "CA-ON", postcode: "M5J 1E3", country: "Canada" }
    });
    expect(toronto).toEqual({ label: "100 Front Street West, Toronto, ON M5J 1E3, Canada", name: "Fairmont Royal York" });
    const montreal = cleanAddress({
      display_name: "Montreal, Urban agglomeration of Montreal, Montreal (administrative region), Quebec, Canada",
      name: "Montréal",
      address: { city: "Montréal", state: "Quebec", "ISO3166-2-lvl4": "CA-QC", country: "Canada" }
    });
    expect(montreal).toEqual({ label: "Montréal, QC, Canada", name: null });
    expect(cleanAddress({ display_name: "Somewhere", address: {} }).label).toBe("Somewhere");
  });

  it("shortens to City, ST", () => {
    expect(shortPlace(null, "100 Front Street West, Toronto, ON M5J 1E3, Canada")).toBe("Toronto, ON");
    expect(shortPlace(null, "Montréal, QC, Canada")).toBe("Montréal, QC");
    expect(shortPlace(null, "1200 Main St, Dallas, TX 75201, United States")).toBe("Dallas, TX");
    expect(shortPlace(null, "43.64530, -79.38060")).toBe("43.64530, -79.38060");
    expect(shortPlace("Acme DC", "anything")).toBe("Acme DC");
  });
});

describe("manual invite", () => {
  it("leaves out the STOP line when the broker sends it themselves", () => {
    const link = driverLink("B".repeat(43));
    const manual = inviteText("Northbound Brokerage", "L-1", link, { optOut: false });
    expect(manual).toContain(link);
    expect(manual).not.toContain("STOP");
    expect(inviteText("Northbound Brokerage", "L-1", link)).toContain("Reply STOP");
  });
});
