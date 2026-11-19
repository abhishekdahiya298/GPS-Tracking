import { z } from "zod";

/**
 * What the company's maps show by default, chosen by the company admin (Settings → Map display).
 * Everyone in the company sees the same; shared by the server (settings, pages) and the browser (maps).
 */
export const ORG_ICON_STYLES = ["photo", "pin", "circle", "square", "top"] as const;
export const ORG_ICON_COLORS = ["status", "type"] as const;

export const OrgMapPrefsSchema = z.object({
  /** How vehicles are drawn: 3D photo (default), 3D pin, round or square badge, or top-down. */
  iconStyle: z.enum(ORG_ICON_STYLES).catch("photo"),
  iconColor: z.enum(ORG_ICON_COLORS).catch("status"),
  /** Vehicle names next to the icons. */
  labels: z.boolean().catch(true),
  /** Chips at the map edges for nearby vehicles that are off screen. */
  nearby: z.boolean().catch(true),
  /** Count bubbles for large fleets when zoomed out. */
  cluster: z.boolean().catch(true),
  /** The company's zones drawn on the live map. */
  zones: z.boolean().catch(true)
});
export type OrgMapPrefs = z.infer<typeof OrgMapPrefsSchema>;

export const DEFAULT_ORG_MAP_PREFS: OrgMapPrefs = { iconStyle: "photo", iconColor: "status", labels: true, nearby: true, cluster: true, zones: true };

/** Stored JSON → full prefs; unknown or missing keys fall back to the defaults. */
export function parseOrgMapPrefs(raw: unknown): OrgMapPrefs {
  const r = OrgMapPrefsSchema.safeParse({ ...DEFAULT_ORG_MAP_PREFS, ...(raw && typeof raw === "object" ? raw : {}) });
  return r.success ? r.data : DEFAULT_ORG_MAP_PREFS;
}
