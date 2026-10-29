import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { passwordError } from "../lib/passwordPolicy.js";
import { endUserSessions } from "../lib/sqliteSessionStore.js";
import { recordAudit } from "../lib/audit.js";
import { requireAuth } from "../middleware/auth.js";
import { loginThrottle } from "../lib/loginThrottle.js";
import { LOCALES } from "@lcm/shared";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(500),
});

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid credentials payload." } });
  }
  const { email, password } = parsed.data;
  // Behind Cloudflare every request arrives from one of its servers; the visitor's own address is in this header.
  const cfIp = req.headers["cf-connecting-ip"];
  const source = (typeof cfIp === "string" && cfIp.trim()) || req.ip || "unknown";
  const retryMs = loginThrottle.retryAfterMs(source, email);
  if (retryMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryMs / 1000)));
    return res.status(429).json({ error: { code: "too_many_attempts", message: "Too many failed sign-in attempts. Wait a few minutes and try again." } });
  }
  // Email addresses are matched without regard to upper/lower case.
  const row = db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase())).get();

  if (!row || !row.active || !verifyPassword(password, row.passwordHash)) {
    loginThrottle.recordFailure(source, email);
    recordAudit({ actorUserId: row?.id ?? null, action: "login_failed", entityType: "user", entityId: row?.id, details: { email: email.toLowerCase() } });
    return res.status(401).json({ error: { code: "invalid_credentials", message: "Invalid email or password." } });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: { code: "session_error", message: "Could not start session." } });
    req.session.userId = row.id;
    loginThrottle.recordSuccess(source, email);
    recordAudit({ actorUserId: row.id, action: "login_succeeded", entityType: "user", entityId: row.id });
    res.json({ ok: true });
  });
});

authRouter.post("/logout", requireAuth, (req, res) => {
  const userId = req.user!.id;
  req.session.destroy(() => {
    recordAudit({ actorUserId: userId, action: "logout", entityType: "user", entityId: userId });
    res.clearCookie("lcm.sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const updateLocaleSchema = z.object({ preferredLocale: z.enum(LOCALES as [string, ...string[]]) });

// Self-service only: any authenticated user may set their own display
// language preference — it never touches role, access, or any other field,
// so it doesn't need the admin-only requireRole guard the rest of user
// management sits behind.
authRouter.patch("/me/locale", requireAuth, (req, res) => {
  const parsed = updateLocaleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid locale." } });
  }
  db.update(users)
    .set({ preferredLocale: parsed.data.preferredLocale as (typeof users.$inferInsert)["preferredLocale"], updatedAt: new Date().toISOString() })
    .where(eq(users.id, req.user!.id))
    .run();
  res.json({ ok: true, preferredLocale: parsed.data.preferredLocale });
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(500), newPassword: z.string().min(1).max(200) });

// Self-service: any signed-in user may change their own password. It asks for the current one (so a borrowed,
// unlocked screen cannot take the account over), applies the same strength rules as an Admin's reset, counts wrong
// guesses toward the same sign-in lockout, and signs out every other device.
authRouter.post("/me/password", requireAuth, (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "invalid_input", message: "Give your current password and a new one." } });
  const { currentPassword, newPassword } = parsed.data;
  const row = db.select().from(users).where(eq(users.id, req.user!.id)).get();
  if (!row) return res.status(404).json({ error: { code: "not_found", message: "User not found." } });

  const cfIp = req.headers["cf-connecting-ip"];
  const source = (typeof cfIp === "string" && cfIp.trim()) || req.ip || "unknown";
  const retryMs = loginThrottle.retryAfterMs(source, row.email);
  if (retryMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryMs / 1000)));
    return res.status(429).json({ error: { code: "too_many_attempts", message: "Too many failed sign-in attempts. Wait a few minutes and try again." } });
  }
  if (!verifyPassword(currentPassword, row.passwordHash)) {
    loginThrottle.recordFailure(source, row.email);
    recordAudit({ actorUserId: row.id, action: "password_change_failed", entityType: "user", entityId: row.id });
    // Not a 401: the person is still signed in, they only mistyped.
    return res.status(400).json({ error: { code: "wrong_current_password", message: "Your current password is not correct." } });
  }
  const weak = passwordError(newPassword, row.email);
  if (weak) return res.status(400).json({ error: { code: "weak_password", message: weak } });
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: { code: "same_password", message: "The new password must be different from the current one." } });
  }

  db.update(users).set({ passwordHash: hashPassword(newPassword), updatedAt: new Date().toISOString() }).where(eq(users.id, row.id)).run();
  loginThrottle.recordSuccess(source, row.email);
  endUserSessions(row.id, req.sessionID);
  // Never log the password itself, only that it changed.
  recordAudit({ actorUserId: row.id, action: "user_password_changed", entityType: "user", entityId: row.id, details: { email: row.email } });
  res.json({ ok: true });
});
