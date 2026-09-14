import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditEvents, users } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole("admin"));

const querySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.coerce.number().optional(),
  actorUserId: z.coerce.number().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(50),
});

auditRouter.get("/", (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid query." } });
  }
  const { entityType, entityId, actorUserId, from, to, page, pageSize } = parsed.data;

  const conditions = [
    entityType ? eq(auditEvents.entityType, entityType) : undefined,
    entityId !== undefined ? eq(auditEvents.entityId, entityId) : undefined,
    actorUserId !== undefined ? eq(auditEvents.actorUserId, actorUserId) : undefined,
    from ? gte(auditEvents.createdAt, from) : undefined,
    to ? lte(auditEvents.createdAt, to) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const where = conditions.length ? and(...conditions) : undefined;

  const total = db.select({ count: sql<number>`count(*)` }).from(auditEvents).where(where).get()?.count ?? 0;
  const rows = db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((id): id is number => id !== null))];
  const actors = actorIds.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).all().filter((u) => actorIds.includes(u.id)) : [];
  const actorById = new Map(actors.map((a) => [a.id, a]));

  const events = rows.map((r) => {
    let details: unknown = null;
    if (r.detailsJson) {
      try {
        details = JSON.parse(r.detailsJson);
      } catch {
        details = r.detailsJson;
      }
    }
    return {
      id: r.id,
      actorUserId: r.actorUserId,
      actorName: r.actorUserId !== null ? (actorById.get(r.actorUserId)?.name ?? `#${r.actorUserId}`) : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason,
      details,
      createdAt: r.createdAt,
    };
  });

  res.json({ events, total, page, pageSize });
});

auditRouter.get("/entity-types", (_req, res) => {
  const rows = db.selectDistinct({ entityType: auditEvents.entityType }).from(auditEvents).all();
  res.json({ entityTypes: rows.map((r) => r.entityType).sort() });
});
