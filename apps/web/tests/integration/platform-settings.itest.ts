import "./setup-env";
import { closeDb, getDb, schema } from "@rio-gps/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appState } from "@/lib/driver-app";
import { clearPlatformSettingsCache, DEFAULT_PLATFORM_SETTINGS, getPlatformSettings, parsePlatformSettings, setPlatformSettings } from "@/lib/platform-settings";

const meta = { ipAddress: null, userAgent: null };
let adminId = "";

beforeAll(async () => {
  const db = getDb();
  await db.execute(sql`delete from platform_settings where key = 'platform'`);
  const [u] = await db.insert(schema.users).values({ email: `ps-${Date.now()}@rio.test`, name: "Root", isSuperAdmin: true, emailVerified: true }).returning();
  adminId = u!.id;
});
afterAll(async () => {
  await getDb().execute(sql`delete from platform_settings where key = 'platform'`);
  await closeDb();
});

describe("platform settings", () => {
  it("defaults when nothing is saved, and bad values fall back", async () => {
    clearPlatformSettingsCache();
    expect(await getPlatformSettings()).toEqual(DEFAULT_PLATFORM_SETTINGS);
    expect(parsePlatformSettings({ driverStaleMinutes: 1 })).toEqual(DEFAULT_PLATFORM_SETTINGS);
  });

  it("saves, reads back and is audited", async () => {
    await setPlatformSettings(adminId, { ...DEFAULT_PLATFORM_SETTINGS, supportEmail: "help@riogps.com", driverStaleMinutes: 45 }, meta);
    const s = await getPlatformSettings();
    expect(s).toMatchObject({ supportEmail: "help@riogps.com", driverStaleMinutes: 45 });
    const [a] = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'platform.settings_updated' and actor_user_id = ${adminId}`);
    expect(a!.n).toBe(1);
  });

  it("the stale time decides Not heard from", () => {
    const row = { signedIn: true, permission: "always", locationEnabled: true, lastReportAt: new Date(Date.now() - 40 * 60_000) };
    expect(appState(row, Date.now(), 30 * 60_000)).toBe("stale");
    expect(appState(row, Date.now(), 45 * 60_000)).toBe("sharing");
  });
});
