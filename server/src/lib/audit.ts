import { db } from "../db/client.js";
import { auditEvents } from "../db/schema.js";

export interface AuditInput {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  reason?: string | null;
  details?: unknown;
  requestId?: string | null;
}

/** Append-only. Application users have no route that updates or deletes
 * audit_events rows. Never pass raw sensitive identity values in `details`. */
export function recordAudit(input: AuditInput): void {
  db.insert(auditEvents)
    .values({
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      reason: input.reason ?? null,
      detailsJson: input.details !== undefined ? JSON.stringify(input.details) : null,
      requestId: input.requestId ?? null,
    })
    .run();
}
