/**
 * Sign-in, the second step, session lookup and sign-out. Plain TypeScript, unit-tested.
 *
 * Password-only accounts: one request, the token arrives in the "set-auth-token" header.
 *
 * Accounts with two-step verification: the password request answers "second step needed" and
 * sets a short-lived (10 minute) pending cookie. The app keeps no cookie jar, so it copies that
 * one cookie into the code request by hand. The auth library refuses a cookie without a trusted
 * Origin, so that request also carries the server's own address as Origin. The token then
 * arrives in the header of the code response. The pending cookie is held in memory only.
 */
import { ApiError, type ApiClient, type TokenStore } from "../api/client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export type SignInResult = { step: "done"; user: SessionUser | null } | { step: "code"; pending: string };
export type CodeKind = "app" | "backup";

/** Finds the pending second-step cookie in a Set-Cookie header (several cookies may be joined by commas). */
export function findPendingCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = /(?:^|[,\s])((?:__Secure-|__Host-)?[\w.-]*two_factor)=([^;,\s]+)/.exec(setCookie);
  return match ? `${match[1]}=${match[2]}` : null;
}

function readUser(value: unknown): SessionUser | null {
  if (!value || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  return typeof u.id === "string" && typeof u.email === "string" ? { id: u.id, email: u.email, name: typeof u.name === "string" ? u.name : "" } : null;
}

/** Words for the person signing in. Mirrors the web login form; never says whether an email exists. */
export function signInMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  if (error.kind === "network" || error.kind === "timeout") return error.message;
  if (error.kind === "rate_limited") return "Too many attempts. Wait a minute and try again.";
  if (error.kind === "server") return "The server has a problem right now. Try again shortly.";
  return "Invalid email or password.";
}

export type CodeFailure = { message: string; restart: boolean };

export function codeFailure(error: unknown, kind: CodeKind): CodeFailure {
  if (!(error instanceof ApiError)) return { message: "Something went wrong. Try again.", restart: false };
  if (error.kind === "network" || error.kind === "timeout") return { message: error.message, restart: false };
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") return { message: "That took too long. Sign in again.", restart: true };
  if (error.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE") return { message: "Too many wrong codes. Sign in again.", restart: true };
  if (error.code === "ACCOUNT_TEMPORARILY_LOCKED") return { message: "Too many wrong codes. Two-step sign-in is paused for a while. Try again later.", restart: false };
  if (error.kind === "rate_limited") return { message: "Too many attempts. Wait a minute and try again.", restart: false };
  if (error.kind === "server") return { message: "The server has a problem right now. Try again shortly.", restart: false };
  return { message: kind === "backup" ? "That backup code is not valid or was already used." : "That code did not match. Try the newest code from your app.", restart: false };
}

export function createAuthService(deps: { api: ApiClient; tokens: TokenStore; baseUrl: string }) {
  const { api, tokens } = deps;
  const origin = new URL(deps.baseUrl).origin;

  async function keepToken(headers: Headers): Promise<void> {
    const token = headers.get("set-auth-token");
    if (!token) throw new ApiError("bad_response", "The server did not start a session. Try again.");
    await tokens.set(token);
  }

  return {
    async signIn(email: string, password: string): Promise<SignInResult> {
      const { data, headers } = await api.send<{ twoFactorRedirect?: boolean; user?: unknown }>("sign-in/email", {
        method: "POST",
        area: "auth",
        anonymous: true,
        body: { email: email.trim(), password }
      });
      if (data?.twoFactorRedirect) {
        const pending = findPendingCookie(headers.get("set-cookie"));
        if (!pending) throw new ApiError("bad_response", "The server did not start the second step. Try again.");
        return { step: "code", pending };
      }
      await keepToken(headers);
      return { step: "done", user: readUser(data?.user) };
    },

    async verifyCode(pending: string, code: string, kind: CodeKind): Promise<void> {
      const { headers } = await api.send<unknown>(kind === "backup" ? "two-factor/verify-backup-code" : "two-factor/verify-totp", {
        method: "POST",
        area: "auth",
        anonymous: true,
        headers: { Cookie: pending, Origin: origin },
        body: { code: kind === "backup" ? code.trim() : code.replace(/\s/g, "") }
      });
      await keepToken(headers);
    },

    /** The signed-in person, or null when the token is missing or no longer valid (it is then cleared). */
    async currentUser(): Promise<SessionUser | null> {
      if (!(await tokens.get())) return null;
      // This route answers 200 with null, not 401, when the session has ended.
      const data = await api.send<{ user?: unknown } | null>("get-session", { area: "auth" }).then((r) => r.data);
      const user = readUser(data?.user);
      if (!user) await tokens.clear();
      return user;
    },

    /** Always ends the session on this phone, even if the server can't be reached. */
    async signOut(): Promise<void> {
      try {
        await api.send<unknown>("sign-out", { method: "POST", area: "auth", body: {} });
      } catch {
        // the token is removed below either way
      } finally {
        await tokens.clear();
      }
    }
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
