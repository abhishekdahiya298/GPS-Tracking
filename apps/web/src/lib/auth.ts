import { getDb, schema } from "@rio-gps/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer, twoFactor } from "better-auth/plugins";
import { writeAudit } from "./audit";
import { isEmailEnabled, passwordResetEmail, sendEmail } from "./email";
import { logger } from "./logger";
import { getServerEnv } from "./env";

const SEVEN_DAYS = 60 * 60 * 24 * 7;
const ONE_DAY = 60 * 60 * 24;
export const RESET_TOKEN_SECONDS = 30 * 60;

function buildAuth() {
  const env = getServerEnv();
  return betterAuth({
    appName: "RIO GPS",
    baseURL: env.AUTH_URL,
    secret: env.AUTH_SECRET,
    trustedOrigins: [env.AUTH_URL],
    telemetry: { enabled: false },
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
        rateLimits: schema.rateLimits,
        twoFactors: schema.twoFactors
      }
    }),
    plugins: [
      // Phones and other non-browser clients send the session token as "Authorization: Bearer …"
      // instead of a cookie. Signed tokens only.
      bearer({ requireSignature: true }),
      // Two-step verification with an authenticator app (TOTP) and one-time backup codes.
      // No "trust this device": every sign-in asks for a code.
      twoFactor({ issuer: "RIO GPS", twoFactorTable: "twoFactors", trustDeviceMaxAge: 0 })
    ],
    user: {
      modelName: "users",
      additionalFields: {
        // Readable by the server; never settable through any auth endpoint (input: false).
        isSuperAdmin: { type: "boolean", required: false, defaultValue: false, input: false }
      }
    },
    session: {
      modelName: "sessions",
      expiresIn: SEVEN_DAYS,
      updateAge: ONE_DAY,
      additionalFields: {
        activeOrganizationId: { type: "string", required: false, input: false }
      }
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      // B2B SaaS: accounts are created by administrators, never by public sign-up.
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      // Self-service "forgot password". Always answers the same way (no account
      // enumeration); the email is only sent when Resend is configured.
      sendResetPassword: async ({ user, url }) => {
        if (!isEmailEnabled()) {
          logger.warn("auth.reset_email_skipped", { reason: "email_not_configured" });
          return;
        }
        try {
          await sendEmail(passwordResetEmail(user.email, user.name, url, RESET_TOKEN_SECONDS / 60));
        } catch {
          // Already logged by sendEmail; don't reveal delivery problems to the requester.
        }
      },
      onPasswordReset: async ({ user }) => {
        await writeAudit({ action: "auth.password_reset_completed", actorUserId: user.id, targetType: "user", targetId: user.id });
      }
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/reset-password": { window: 300, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 }
      }
    },
    advanced: {
      cookiePrefix: "rio",
      useSecureCookies: env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      database: { generateId: "uuid" },
      // Explicit: Better Auth's default silently disables origin/CSRF checks when
      // NODE_ENV=test. Protection must never hinge on an environment variable.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // Caddy is the only ingress and sets X-Forwarded-For itself.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] }
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await writeAudit({
              action: "auth.login",
              actorUserId: session.userId,
              targetType: "session",
              targetId: session.id,
              ipAddress: session.ipAddress ?? null,
              userAgent: session.userAgent ?? null
            });
          }
        },
        delete: {
          after: async (session) => {
            await writeAudit({
              action: "auth.session_ended",
              actorUserId: session.userId,
              targetType: "session",
              targetId: session.id
            });
          }
        }
      }
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/change-password" && !(ctx.context.returned instanceof APIError) && ctx.context.session) {
          await writeAudit({
            action: "auth.password_changed",
            actorUserId: ctx.context.session.user.id,
            targetType: "user",
            targetId: ctx.context.session.user.id,
            ipAddress: ctx.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: ctx.request?.headers.get("user-agent") ?? null
          });
        }
        // Two-step verification: record turning it on or off, and failed second steps.
        if (ctx.path.startsWith("/two-factor/")) {
          const failed = ctx.context.returned instanceof APIError;
          const ipAddress = ctx.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
          const userAgent = ctx.request?.headers.get("user-agent") ?? null;
          const userId = ctx.context.session?.user.id ?? ctx.context.newSession?.user.id ?? null;
          const verify = ctx.path === "/two-factor/verify-totp" || ctx.path === "/two-factor/verify-backup-code";
          // A pending sign-in carries the short-lived two-factor cookie; setup from Settings does not.
          const signingIn = /(^|;\s*)[^=;]*two_factor=/.test(ctx.request?.headers.get("cookie") ?? "");
          let action: string | null = null;
          if (verify && failed) action = "auth.two_step_failed";
          else if (ctx.path === "/two-factor/verify-totp" && !failed && !signingIn) action = "auth.two_step_enabled";
          else if (ctx.path === "/two-factor/disable" && !failed) action = "auth.two_step_disabled";
          else if (ctx.path === "/two-factor/generate-backup-codes" && !failed) action = "auth.backup_codes_replaced";
          else if (ctx.path === "/two-factor/verify-backup-code" && !failed) action = "auth.backup_code_used";
          if (action) {
            await writeAudit({ action, actorUserId: userId, targetType: "user", targetId: userId, ipAddress, userAgent, ...(failed && ctx.context.returned instanceof APIError ? { metadata: { status: ctx.context.returned.status } } : {}) });
          }
        }
        if (ctx.path === "/sign-in/email" && ctx.context.returned instanceof APIError) {
          const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase().slice(0, 254) : null;
          await writeAudit({
            action: "auth.login_failed",
            ipAddress: ctx.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: ctx.request?.headers.get("user-agent") ?? null,
            metadata: { email, status: ctx.context.returned.status }
          });
        }
      })
    }
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let instance: Auth | null = null;

/** Lazily constructed so `next build` (which has no runtime secrets) can import route modules. */
export function getAuth(): Auth {
  if (!instance) {
    instance = buildAuth();
  }
  return instance;
}
