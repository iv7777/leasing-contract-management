import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { verifyPassword } from "../lib/password.js";
import { recordAudit } from "../lib/audit.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid credentials payload." } });
  }
  const { email, password } = parsed.data;
  const row = db.select().from(users).where(eq(users.email, email)).get();

  if (!row || !row.active || !verifyPassword(password, row.passwordHash)) {
    recordAudit({ actorUserId: row?.id ?? null, action: "login_failed", entityType: "user", entityId: row?.id });
    return res.status(401).json({ error: { code: "invalid_credentials", message: "Invalid email or password." } });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: { code: "session_error", message: "Could not start session." } });
    req.session.userId = row.id;
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
