import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, type TokenStore } from "../api/client";
import { codeFailure, createAuthService, findPendingCookie, signInMessage } from "./service";

function memoryTokens(initial: string | null = null): TokenStore & { value: string | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (t: string) => void (store.value = t),
    clear: async () => void (store.value = null)
  };
  return store;
}
type Call = { url: string; init: RequestInit };
function setup(responses: Array<Response | Error>, token: string | null = null) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const tokens = memoryTokens(token);
  const api = createApiClient({ baseUrl: "https://gps.test", tokens, fetchImpl });
  return { calls, tokens, auth: createAuthService({ api, tokens, baseUrl: "https://gps.test/" }) };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const headersOf = (c: Call) => c.init.headers as Record<string, string>;

describe("findPendingCookie", () => {
  it("finds the cookie alone, with the production prefix, and among other cookies", () => {
    expect(findPendingCookie("rio.two_factor=abc.def; Max-Age=600; Path=/; HttpOnly")).toBe("rio.two_factor=abc.def");
    expect(findPendingCookie("__Secure-rio.two_factor=a%2Fb.c; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax")).toBe("__Secure-rio.two_factor=a%2Fb.c");
    expect(
      findPendingCookie("__Secure-rio.session_token=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/, __Secure-rio.two_factor=xyz; Max-Age=600; Path=/")
    ).toBe("__Secure-rio.two_factor=xyz");
  });
  it("returns null when it is absent", () => {
    expect(findPendingCookie(null)).toBeNull();
    expect(findPendingCookie("rio.session_token=abc; Path=/")).toBeNull();
  });
});

describe("sign-in without two-step verification", () => {
  it("stores the token from the response header and sends no token, cookie or Origin", async () => {
    const { auth, tokens, calls } = setup([json({ user: { id: "u1", name: "Ann", email: "ann@a.test" } }, 200, { "set-auth-token": "tok.sig" })], "stale");
    const result = await auth.signIn(" ann@a.test ", "pw");
    expect(result).toEqual({ step: "done", user: { id: "u1", name: "Ann", email: "ann@a.test" } });
    expect(tokens.value).toBe("tok.sig");
    expect(calls[0]!.url).toBe("https://gps.test/api/auth/sign-in/email");
    expect(calls[0]!.init.body).toBe('{"email":"ann@a.test","password":"pw"}');
    expect(headersOf(calls[0]!).Authorization).toBeUndefined();
    expect(headersOf(calls[0]!).Cookie).toBeUndefined();
    expect(headersOf(calls[0]!).Origin).toBeUndefined();
  });

  it("stores nothing when the password is wrong", async () => {
    const { auth, tokens } = setup([json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401)]);
    const error = await auth.signIn("ann@a.test", "bad").catch((e) => e);
    expect(signInMessage(error)).toBe("Invalid email or password.");
    expect(tokens.value).toBeNull();
  });

  it("fails clearly if the server sends no token", async () => {
    const { auth, tokens } = setup([json({ user: {} })]);
    await expect(auth.signIn("ann@a.test", "pw")).rejects.toMatchObject({ kind: "bad_response" });
    expect(tokens.value).toBeNull();
  });
});

describe("sign-in with two-step verification", () => {
  const first = () => json({ twoFactorRedirect: true }, 200, { "set-cookie": "__Secure-rio.two_factor=pend.sig; Max-Age=600; Path=/; HttpOnly", "set-auth-token": "not-a-session" });

  it("does not keep any token after the password alone", async () => {
    const { auth, tokens } = setup([first()]);
    expect(await auth.signIn("ann@a.test", "pw")).toEqual({ step: "code", pending: "__Secure-rio.two_factor=pend.sig" });
    expect(tokens.value).toBeNull();
  });

  it("sends the code with the pending cookie and the server's own Origin, then keeps the token", async () => {
    const { auth, tokens, calls } = setup([json({ token: "x" }, 200, { "set-auth-token": "real.sig" })]);
    await auth.verifyCode("__Secure-rio.two_factor=pend.sig", "123 456", "app");
    expect(calls[0]!.url).toBe("https://gps.test/api/auth/two-factor/verify-totp");
    expect(headersOf(calls[0]!).Cookie).toBe("__Secure-rio.two_factor=pend.sig");
    expect(headersOf(calls[0]!).Origin).toBe("https://gps.test");
    expect(headersOf(calls[0]!).Authorization).toBeUndefined();
    expect(calls[0]!.init.body).toBe('{"code":"123456"}');
    expect(tokens.value).toBe("real.sig");
  });

  it("uses the backup-code route and keeps spaces out of nothing but the ends", async () => {
    const { auth, calls } = setup([json({}, 200, { "set-auth-token": "real.sig" })]);
    await auth.verifyCode("rio.two_factor=p", " ab12-cd34 ", "backup");
    expect(calls[0]!.url).toBe("https://gps.test/api/auth/two-factor/verify-backup-code");
    expect(calls[0]!.init.body).toBe('{"code":"ab12-cd34"}');
  });

  it("explains a wrong code, an expired step and a lock, and says when to start again", async () => {
    const wrong = new ApiError("unauthorized", "Invalid code", 401, "INVALID_CODE");
    expect(codeFailure(wrong, "app")).toEqual({ message: "That code did not match. Try the newest code from your app.", restart: false });
    expect(codeFailure(wrong, "backup").message).toBe("That backup code is not valid or was already used.");
    expect(codeFailure(new ApiError("unauthorized", "x", 401, "INVALID_TWO_FACTOR_COOKIE"), "app")).toEqual({ message: "That took too long. Sign in again.", restart: true });
    expect(codeFailure(new ApiError("rate_limited", "x", 429), "app").restart).toBe(false);
    expect(codeFailure(new ApiError("network", "Can't reach the server. Check your connection."), "app").message).toMatch(/reach the server/);
  });

  it("keeps no token when the code is wrong", async () => {
    const { auth, tokens } = setup([json({ code: "INVALID_CODE", message: "Invalid code" }, 401)]);
    await expect(auth.verifyCode("rio.two_factor=p", "000000", "app")).rejects.toMatchObject({ code: "INVALID_CODE" });
    expect(tokens.value).toBeNull();
  });
});

describe("session lookup and sign-out", () => {
  it("returns the user for a valid token", async () => {
    const { auth, calls } = setup([json({ session: { id: "s" }, user: { id: "u1", name: "Ann", email: "ann@a.test" } })], "tok.sig");
    expect(await auth.currentUser()).toEqual({ id: "u1", name: "Ann", email: "ann@a.test" });
    expect(calls[0]!.url).toBe("https://gps.test/api/auth/get-session");
    expect(headersOf(calls[0]!).Authorization).toBe("Bearer tok.sig");
  });

  it("clears the token when the server says the session has ended (200 with null)", async () => {
    const { auth, tokens } = setup([json(null)], "old");
    expect(await auth.currentUser()).toBeNull();
    expect(tokens.value).toBeNull();
  });

  it("asks nothing when there is no token, and keeps the token when the phone is offline", async () => {
    const none = setup([]);
    expect(await none.auth.currentUser()).toBeNull();
    expect(none.calls).toHaveLength(0);
    const offline = setup([new TypeError("Network request failed")], "tok.sig");
    await expect(offline.auth.currentUser()).rejects.toMatchObject({ kind: "network" });
    expect(offline.tokens.value).toBe("tok.sig");
  });

  it("sign-out tells the server and clears the token, even when offline", async () => {
    const online = setup([json({ success: true })], "tok.sig");
    await online.auth.signOut();
    expect(online.calls[0]!.url).toBe("https://gps.test/api/auth/sign-out");
    expect(headersOf(online.calls[0]!).Authorization).toBe("Bearer tok.sig");
    expect(online.tokens.value).toBeNull();
    const offline = setup([new TypeError("Network request failed")], "tok.sig");
    await offline.auth.signOut();
    expect(offline.tokens.value).toBeNull();
  });
});
