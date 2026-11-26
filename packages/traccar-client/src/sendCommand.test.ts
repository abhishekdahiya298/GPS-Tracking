import { afterEach, describe, expect, it, vi } from "vitest";
import { TraccarRestClient } from "./restClient.js";

const client = new TraccarRestClient({ baseUrl: "http://traccar:8082", username: "u", password: "p" });
afterEach(() => vi.unstubAllGlobals());

describe("sendCommand", () => {
  it("posts a custom text command and reports it as sent (200)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client.sendCommand(3, "getgps")).resolves.toBe("sent");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://traccar:8082/api/commands/send");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init.body)).toEqual({ deviceId: 3, type: "custom", attributes: { data: "getgps" } });
  });

  it("reports a command for an offline device as queued (202)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 202 })));
    await expect(client.sendCommand(3, "getinfo")).resolves.toBe("queued");
  });

  it("throws on Traccar errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 400, statusText: "Bad Request" })));
    await expect(client.sendCommand(3, "getgps")).rejects.toThrow(/400/);
  });
});
