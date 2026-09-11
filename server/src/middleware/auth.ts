import type { Request, Response, NextFunction } from "express";
import { db } from "../db/client.js";
import { users, userProperties } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Role } from "@lcm/shared";

export interface AuthedUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  canDownloadPdf: boolean;
  canPrint: boolean;
  preferredLocale: "en" | "zh";
  propertyIds: number[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/** Loads the current user (with property assignments) onto req.user.
 * Every route that touches contract/financial/document data must sit behind
 * this, and behind requireRole/requireProperty as appropriate — scope checks
 * are centralized here, not left to individual handlers to remember. */
export async function attachUser(req: Request, res: Response, next: NextFunction) {
  const userId = req.session.userId;
  if (!userId) return next();

  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row || !row.active) {
    req.session.destroy(() => {});
    return next();
  }

  const assignments = db
    .select({ propertyId: userProperties.propertyId })
    .from(userProperties)
    .where(eq(userProperties.userId, row.id))
    .all();

  req.user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active,
    canDownloadPdf: row.canDownloadPdf,
    canPrint: row.canPrint,
    preferredLocale: row.preferredLocale,
    propertyIds: assignments.map((a) => a.propertyId),
  };
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: { code: "unauthenticated", message: "Login required." } });
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: "unauthenticated", message: "Login required." } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role." } });
    }
    next();
  };
}

/** True if the user can access the given property (Admin sees all). */
export function canAccessProperty(user: AuthedUser, propertyId: number): boolean {
  return user.role === "admin" || user.propertyIds.includes(propertyId);
}

/** True if the user can access every property in the list — used for
 * multi-property agreements, where §5 requires assignment to ALL covered
 * properties, not just one. */
export function canAccessAllProperties(user: AuthedUser, propertyIds: number[]): boolean {
  return user.role === "admin" || propertyIds.every((id) => user.propertyIds.includes(id));
}
