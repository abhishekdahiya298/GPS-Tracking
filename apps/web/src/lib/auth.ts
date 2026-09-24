import { getDb, schema } from "@rio-gps/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { writeAudit } from "./audit";
import { getServerEnv } from "./env";

const SEVEN_DAYS = 60 * 60 * 24 * 7;
const ONE_DAY = 60 * 60 * 24;

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
        rateLimits: schema.rateLimits
      }
    }),
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
      revokeSessionsOnPasswordReset: true
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
        "/reset-password": { window: 300, max: 5 }
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
