import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  users,
  userProperties,
  auditEvents,
  documents,
  receipts,
  depositTransactions,
  chargeAdjustments,
  usageEntries,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { hashPassword } from "../lib/password.js";
import { ROLES } from "@lcm/shared";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("admin"));

function toPublic(row: typeof users.$inferSelect, propertyIds: number[]) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    canDownloadPdf: row.canDownloadPdf,
    canPrint: row.canPrint,
    preferredLocale: row.preferredLocale,
    propertyIds,
  };
}

usersRouter.get("/", (_req, res) => {
  const all = db.select().from(users).all();
  const assignments = db.select().from(userProperties).all();
  const byUser = new Map<number, number[]>();
  for (const a of assignments) {
    byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a.propertyId]);
  }
  res.json({ users: all.map((u) => toPublic(u, byUser.get(u.id) ?? [])) });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES as [string, ...string[]]),
  canDownloadPdf: z.boolean().optional(),
  canPrint: z.boolean().optional(),
  propertyIds: z.array(z.number()).optional(),
});

usersRouter.post("/", (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid user payload.", details: parsed.error.flatten() } });
  }
  const { propertyIds = [], password, ...rest } = parsed.data;

  if (db.select().from(users).where(eq(users.email, rest.email)).get()) {
    return res.status(409).json({ error: { code: "email_taken", message: "Another user already uses this email." } });
  }

  const inserted = db
    .insert(users)
    .values({
      ...rest,
      role: rest.role as (typeof users.$inferInsert)["role"],
      passwordHash: hashPassword(password),
      canDownloadPdf: rest.canDownloadPdf ?? false,
      canPrint: rest.canPrint ?? false,
    })
    .returning()
    .get();

  for (const propertyId of propertyIds) {
    db.insert(userProperties).values({ userId: inserted.id, propertyId }).run();
  }

  recordAudit({ actorUserId: req.user!.id, action: "user_created", entityType: "user", entityId: inserted.id });
  res.status(201).json({ user: toPublic(inserted, propertyIds) });
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  active: z.boolean().optional(),
  canDownloadPdf: z.boolean().optional(),
  canPrint: z.boolean().optional(),
  propertyIds: z.array(z.number()).optional(),
});

usersRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid user payload." } });
  }
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "User not found." } });

  // An admin can never deactivate or demote their own account — doing so
  // would kill their own session on the very next request (attachUser
  // destroys the session for any inactive user) with no way back in short
  // of another admin, or the server console, fixing it for them.
  if (id === req.user!.id) {
    if (parsed.data.active === false) {
      return res.status(400).json({ error: { code: "self_modification_blocked", message: "You cannot deactivate your own account." } });
    }
    if (parsed.data.role !== undefined && parsed.data.role !== "admin") {
      return res.status(400).json({ error: { code: "self_modification_blocked", message: "You cannot change your own admin role." } });
    }
  }

  if (parsed.data.email && parsed.data.email !== existing.email) {
    const emailTaken = db.select().from(users).where(eq(users.email, parsed.data.email)).get();
    if (emailTaken) {
      return res.status(409).json({ error: { code: "email_taken", message: "Another user already uses this email." } });
    }
  }

  const { propertyIds, ...fields } = parsed.data;
  const updated = db
    .update(users)
    .set({ ...fields, role: fields.role as (typeof users.$inferInsert)["role"] | undefined, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id))
    .returning()
    .get();

  if (propertyIds) {
    db.delete(userProperties).where(eq(userProperties.userId, id)).run();
    for (const propertyId of propertyIds) {
      db.insert(userProperties).values({ userId: id, propertyId }).run();
    }
  }

  const deactivated = existing.active && updated.active === false;
  recordAudit({
    actorUserId: req.user!.id,
    action: deactivated ? "user_deactivated" : "user_updated",
    entityType: "user",
    entityId: id,
  });
  const finalPropertyIds =
    propertyIds ?? db.select({ propertyId: userProperties.propertyId }).from(userProperties).where(eq(userProperties.userId, id)).all().map((r) => r.propertyId);
  res.json({ user: toPublic(updated, finalPropertyIds) });
});

const setPasswordSchema = z.object({ password: z.string().min(8) });

usersRouter.post("/:id/set-password", (req, res) => {
  const id = Number(req.params.id);
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Password must be at least 8 characters." } });
  }
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "User not found." } });

  db.update(users)
    .set({ passwordHash: hashPassword(parsed.data.password), updatedAt: new Date().toISOString() })
    .where(eq(users.id, id))
    .run();

  // Never log the password itself, only that a reset happened.
  recordAudit({ actorUserId: req.user!.id, action: "user_password_reset", entityType: "user", entityId: id });
  res.json({ ok: true });
});

usersRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "User not found." } });

  if (id === req.user!.id) {
    return res.status(400).json({ error: { code: "self_modification_blocked", message: "You cannot delete your own account." } });
  }

  // A user with any real history (logged an audit event, uploaded a
  // document, recorded a receipt, etc.) can never be hard-deleted without
  // orphaning that history — deactivate instead. Only a user created by
  // mistake and never actually used is safe to remove outright.
  const hasHistory =
    !!db.select().from(auditEvents).where(eq(auditEvents.actorUserId, id)).get() ||
    !!db.select().from(documents).where(eq(documents.uploadedBy, id)).get() ||
    !!db.select().from(receipts).where(eq(receipts.recordedBy, id)).get() ||
    !!db.select().from(depositTransactions).where(eq(depositTransactions.actorUserId, id)).get() ||
    !!db.select().from(depositTransactions).where(eq(depositTransactions.approvedBy, id)).get() ||
    !!db.select().from(chargeAdjustments).where(eq(chargeAdjustments.actorUserId, id)).get() ||
    !!db.select().from(usageEntries).where(eq(usageEntries.enteredBy, id)).get();

  if (hasHistory) {
    return res.status(409).json({
      error: {
        code: "has_history",
        message: "This user has recorded activity and cannot be deleted — deactivate the account instead.",
      },
    });
  }

  db.delete(userProperties).where(eq(userProperties.userId, id)).run();
  db.delete(users).where(eq(users.id, id)).run();
  recordAudit({ actorUserId: req.user!.id, action: "user_deleted", entityType: "user", entityId: id, details: { email: existing.email } });
  res.status(204).send();
});
