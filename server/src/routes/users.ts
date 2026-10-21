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
  properties,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { changesBetween } from "../lib/auditDetail.js";
import { hashPassword } from "../lib/password.js";
import { PASSWORD_RULE, passwordError } from "../lib/passwordPolicy.js";
import { endUserSessions } from "../lib/sqliteSessionStore.js";
import { ROLES, LOCALES } from "@lcm/shared";

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

/** Whether another account already uses this address (upper/lower case ignored). */
function emailTaken(email: string, exceptUserId?: number): boolean {
  return db.select().from(users).all().some((u) => u.id !== exceptUserId && u.email.toLowerCase() === email.toLowerCase());
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
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  role: z.enum(ROLES as [string, ...string[]]),
  canDownloadPdf: z.boolean().optional(),
  canPrint: z.boolean().optional(),
  preferredLocale: z.enum(LOCALES as [string, ...string[]]).optional(),
  propertyIds: z.array(z.number().int()).optional(),
});

usersRouter.post("/", (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid user payload.", details: parsed.error.flatten() } });
  }
  const { propertyIds = [], password, ...rest } = parsed.data;

  const weak = passwordError(password, rest.email);
  if (weak) return res.status(400).json({ error: { code: "weak_password", message: weak } });
  if (emailTaken(rest.email)) {
    return res.status(409).json({ error: { code: "email_taken", message: "Another user already uses this email." } });
  }
  const missingProperty = propertyIds.find((pid) => !db.select().from(properties).where(eq(properties.id, pid)).get());
  if (missingProperty !== undefined) return res.status(400).json({ error: { code: "invalid_reference", message: `Property ${missingProperty} not found.` } });

  const inserted = db
    .insert(users)
    .values({
      ...rest,
      role: rest.role as (typeof users.$inferInsert)["role"],
      preferredLocale: rest.preferredLocale as (typeof users.$inferInsert)["preferredLocale"] | undefined,
      passwordHash: hashPassword(password),
      canDownloadPdf: rest.canDownloadPdf ?? false,
      canPrint: rest.canPrint ?? false,
    })
    .returning()
    .get();

  for (const propertyId of propertyIds) {
    db.insert(userProperties).values({ userId: inserted.id, propertyId }).run();
  }

  recordAudit({ actorUserId: req.user!.id, action: "user_created", entityType: "user", entityId: inserted.id, details: { email: inserted.email, name: inserted.name, role: inserted.role } });
  res.status(201).json({ user: toPublic(inserted, propertyIds) });
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  active: z.boolean().optional(),
  canDownloadPdf: z.boolean().optional(),
  canPrint: z.boolean().optional(),
  preferredLocale: z.enum(LOCALES as [string, ...string[]]).optional(),
  propertyIds: z.array(z.number().int()).optional(),
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
    if (emailTaken(parsed.data.email, id)) {
      return res.status(409).json({ error: { code: "email_taken", message: "Another user already uses this email." } });
    }
  }

  const { propertyIds, ...fields } = parsed.data;
  const missingProperty = (propertyIds ?? []).find((pid) => !db.select().from(properties).where(eq(properties.id, pid)).get());
  if (missingProperty !== undefined) return res.status(400).json({ error: { code: "invalid_reference", message: `Property ${missingProperty} not found.` } });
  const updated = db
    .update(users)
    .set({
      ...fields,
      role: fields.role as (typeof users.$inferInsert)["role"] | undefined,
      preferredLocale: fields.preferredLocale as (typeof users.$inferInsert)["preferredLocale"] | undefined,
      updatedAt: new Date().toISOString(),
    })
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
  if (deactivated) endUserSessions(id);
  recordAudit({
    actorUserId: req.user!.id,
    action: deactivated ? "user_deactivated" : "user_updated",
    entityType: "user",
    entityId: id,
    details: {
      email: updated.email,
      changes: {
        ...changesBetween(
          { name: existing.name, email: existing.email, role: existing.role, active: existing.active, canDownloadPdf: existing.canDownloadPdf, canPrint: existing.canPrint, preferredLocale: existing.preferredLocale },
          { name: updated.name, email: updated.email, role: updated.role, active: updated.active, canDownloadPdf: updated.canDownloadPdf, canPrint: updated.canPrint, preferredLocale: updated.preferredLocale },
        ),
        ...(propertyIds ? { propertyIds: { from: null, to: propertyIds.join(", ") } } : {}),
      },
    },
  });
  const finalPropertyIds =
    propertyIds ?? db.select({ propertyId: userProperties.propertyId }).from(userProperties).where(eq(userProperties.userId, id)).all().map((r) => r.propertyId);
  res.json({ user: toPublic(updated, finalPropertyIds) });
});

const setPasswordSchema = z.object({ password: z.string().min(1).max(200) });

usersRouter.post("/:id/set-password", (req, res) => {
  const id = Number(req.params.id);
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: PASSWORD_RULE } });
  }
  const existing = db.select().from(users).where(eq(users.id, id)).get();
  if (!existing) return res.status(404).json({ error: { code: "not_found", message: "User not found." } });
  const weak = passwordError(parsed.data.password, existing.email);
  if (weak) return res.status(400).json({ error: { code: "weak_password", message: weak } });

  db.update(users)
    .set({ passwordHash: hashPassword(parsed.data.password), updatedAt: new Date().toISOString() })
    .where(eq(users.id, id))
    .run();
  // The new password must be used from now on: end every session signed in with the old one.
  endUserSessions(id);

  // Never log the password itself, only that a reset happened.
  recordAudit({ actorUserId: req.user!.id, action: "user_password_reset", entityType: "user", entityId: id, details: { email: db.select({ e: users.email }).from(users).where(eq(users.id, id)).get()?.e } });
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
