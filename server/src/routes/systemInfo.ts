import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { appSettings } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { APP_VERSION, BUILD_DATE, BUILD_NUMBER } from "../lib/buildInfo.js";

export const systemInfoRouter = Router();
systemInfoRouter.use(requireAuth);

function getSettings() {
  return db.select().from(appSettings).where(eq(appSettings.id, 1)).get();
}

systemInfoRouter.get("/", (_req, res) => {
  const settings = getSettings();
  res.json({
    version: APP_VERSION,
    buildDate: BUILD_DATE,
    buildNumber: BUILD_NUMBER,
    copyright: settings?.copyrightText ?? "",
  });
});

const updateSchema = z.object({ copyright: z.string().min(1).max(500) });

systemInfoRouter.patch("/", requireRole("admin"), (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "invalid_input", message: "Invalid copyright text." } });
  }

  db.update(appSettings)
    .set({ copyrightText: parsed.data.copyright, updatedAt: new Date().toISOString(), updatedBy: req.user!.id })
    .where(eq(appSettings.id, 1))
    .run();

  recordAudit({ actorUserId: req.user!.id, action: "system_copyright_updated", entityType: "app_settings", entityId: 1 });

  const settings = getSettings();
  res.json({ version: APP_VERSION, buildDate: BUILD_DATE, buildNumber: BUILD_NUMBER, copyright: settings?.copyrightText ?? "" });
});
