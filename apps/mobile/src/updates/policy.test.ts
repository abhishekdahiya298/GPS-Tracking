import { describe, expect, it, vi } from "vitest";
import { fetchUpdatePolicy, isSnoozed } from "./policy";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("update policy", () => {
  it("asks the server with this app's platform and version", async () => {
    const fetchImpl = vi.fn(async () => json({ status: "required", latestVersion: "1.4.0", minVersion: "1.3.0", updateUrl: "https://play.google.com/x", notes: null }));
    const r = await fetchUpdatePolicy({ baseUrl: "https://x.test/", platform: "android", version: "1.2.0", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ status: "required", updateUrl: "https://play.google.com/x" });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://x.test/api/v1/app/version?platform=android&version=1.2.0");
  });
  it("never blocks the app when the check fails", async () => {
    expect(await fetchUpdatePolicy({ baseUrl: "https://x.test", platform: "ios", version: "1.0.0", fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch })).toBeNull();
    expect(await fetchUpdatePolicy({ baseUrl: "https://x.test", platform: "ios", version: "1.0.0", fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch })).toBeNull();
  });
  it("Later lasts a day, and a newer version asks again", () => {
    const now = 1_000_000_000;
    expect(isSnoozed({ version: "1.4.0", at: now - 3_600_000 }, "1.4.0", now)).toBe(true);
    expect(isSnoozed({ version: "1.4.0", at: now - 25 * 3_600_000 }, "1.4.0", now)).toBe(false);
    expect(isSnoozed({ version: "1.4.0", at: now }, "1.5.0", now)).toBe(false);
  });
});
