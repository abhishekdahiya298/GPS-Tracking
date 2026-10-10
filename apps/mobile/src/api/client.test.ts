import { describe, expect, it, vi } from "vitest";
import { ApiError, buildUrl, createApiClient, type TokenStore } from "./client";

function memoryTokens(initial: string | null = null): TokenStore & { value: string | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (t: string) => void (store.value = t),
    clear: async () => void (store.value = null)
  };
  return store;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("buildUrl", () => {
  it("puts data routes under /api/v1 and sign-in routes under /api/auth", () => {
    expect(buildUrl("https://x.test/", "/locations/current")).toBe("https://x.test/api/v1/locations/current");
    expect(buildUrl("https://x.test", "sign-in/email", { area: "auth" })).toBe("https://x.test/api/auth/sign-in/email");
  });
  it("encodes query values and skips empty ones", () => {
    expect(buildUrl("https://x.test", "locations/history", { query: { deviceId: "a b", from: null, limit: 10 } })).toBe(
      "https://x.test/api/v1/locations/history?deviceId=a%20b&limit=10"
    );
  });
});

describe("api client", () => {
  it("sends the stored token as a bearer header and never sends cookies", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }));
    const api = createApiClient({ baseUrl: "https://x.test", tokens: memoryTokens("tok.sig"), fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.get("locations/current");
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok.sig");
    expect(init.credentials).toBe("omit");
  });

  it("sends no token for anonymous requests", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json({ ok: true }));
    const api = createApiClient({ baseUrl: "https://x.test", tokens: memoryTokens("tok.sig"), fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.send("sign-in/email", { method: "POST", area: "auth", anonymous: true, body: { email: "a@b.c" } });
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.body).toBe('{"email":"a@b.c"}');
  });

  it("clears the token and reports sign-out on 401", async () => {
    const tokens = memoryTokens("old");
    const onSignedOut = vi.fn();
    const api = createApiClient({ baseUrl: "https://x.test", tokens, fetchImpl: async () => json({ error: "Not signed in" }, 401), onSignedOut });
    await expect(api.get("locations/current")).rejects.toMatchObject({ kind: "unauthorized", status: 401, message: "Not signed in" });
    expect(tokens.value).toBeNull();
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it("keeps the token when a sign-in attempt is rejected", async () => {
    const tokens = memoryTokens("keep");
    const api = createApiClient({ baseUrl: "https://x.test", tokens, fetchImpl: async () => json({ message: "Invalid email or password" }, 401) });
    await expect(api.send("sign-in/email", { method: "POST", area: "auth", anonymous: true, body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(tokens.value).toBe("keep");
  });

  it("maps a failed connection and a slow server to clear errors", async () => {
    const offline = createApiClient({ baseUrl: "https://x.test", tokens: memoryTokens(), fetchImpl: async () => Promise.reject(new TypeError("Network request failed")) });
    await expect(offline.get("health/ready")).rejects.toMatchObject({ kind: "network" });

    const slowFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const slow = createApiClient({ baseUrl: "https://x.test", tokens: memoryTokens(), fetchImpl: slowFetch, timeoutMs: 10 });
    await expect(slow.get("health/ready")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("maps status codes to error kinds", async () => {
    for (const [status, kind] of [[403, "forbidden"], [404, "not_found"], [429, "rate_limited"], [503, "server"]] as const) {
      const api = createApiClient({ baseUrl: "https://x.test", tokens: memoryTokens(), fetchImpl: async () => json({}, status) });
      await expect(api.get("x")).rejects.toMatchObject({ kind, status });
    }
  });
});
