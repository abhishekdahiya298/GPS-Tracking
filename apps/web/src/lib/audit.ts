import { getDb, schema } from "@rio-gps/db";
import { logger } from "./logger";

export interface AuditEntry {
  action: string;
  actorUserId?: string | null;
  organizationId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /** Identifiers and non-sensitive facts only — never passwords, tokens or cookies. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Appends to audit_logs. A failure is logged at error level (so it is visible
 * and alertable) but does not fail the user's request.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await getDb().insert(schema.auditLogs).values({
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      organizationId: entry.organizationId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 512) : null,
      requestId: entry.requestId ?? null,
      metadata: entry.metadata ?? null
    });
  } catch (err) {
    logger.error("audit.write_failed", { action: entry.action }, err);
  }
}
