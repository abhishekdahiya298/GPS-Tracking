import { afterEach, describe, expect, it, vi } from "vitest";
import { TraccarRestClient } from "./restClient.js";

const client = new TraccarRestClient({ baseUrl: "http://traccar:8082", username: "u", password: "p" });
afterEach(() => vi.unstubAllGlobals());

describe("ensureDevice", () => {
  it("returns the existing device without creating", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 7, uniqueId: "864361078566115", name: "x", status: "online" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await client.ensureDevice("FTM880", "864361078566115");
    expect(out).toMatchObject({ created: false, device: { id: 7 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the device with basic auth when missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 9, uniqueId: "864361078566115", name: "FTM880", status: "unknown" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await client.ensureDevice("FTM880", "864361078566115");
    expect(out).toMatchObject({ created: true, device: { id: 9 } });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("http://traccar:8082/api/devices");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init.body)).toEqual({ name: "FTM880", uniqueId: "864361078566115" });
  });

  it("throws on Traccar errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("[]", { status: 200 })).mockResolvedValueOnce(new Response("", { status: 400, statusText: "Bad Request" })));
    await expect(client.ensureDevice("x", "864361078566115")).rejects.toThrow(/400/);
  });
});
