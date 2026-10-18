import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { backupRuns } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { runBackup } from "../jobs/backup.js";

export const backupsRouter = Router();
backupsRouter.use(requireAuth, requireRole("admin"));

backupsRouter.get("/", (_req, res) => {
  const runs = db.select().from(backupRuns).orderBy(desc(backupRuns.id)).limit(100).all();
  res.json({ runs });
});

backupsRouter.post("/run", async (req, res) => {
  try {
    const result = await runBackup();
    recordAudit({ actorUserId: req.user!.id, action: "backup_run_triggered", entityType: "backup_run", details: result });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: { code: "backup_failed", message: err instanceof Error ? err.message : "Backup failed." } });
  }
});

const commentSchema = z.object({ comment: z.string().max(500).nullable() });

backupsRouter.patch("/:id/comment", (req, res) => {
  const id = Number(req.params.id);
  const parsed = commentSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    return res.status(400).json({ error: { code: "validation_error", message: "Comment must be text of at most 500 characters." } });
  }
  const run = db.select().from(backupRuns).where(eq(backupRuns.id, id)).get();
  if (!run) return res.status(404).json({ error: { code: "not_found", message: "Backup run not found." } });

  const comment = parsed.data.comment?.trim() || null;
  db.update(backupRuns).set({ comment }).where(eq(backupRuns.id, id)).run();
  recordAudit({ actorUserId: req.user!.id, action: "backup_comment_updated", entityType: "backup_run", entityId: id, details: { comment } });
  res.json({ id, comment });
});

backupsRouter.get("/:id/download", (req, res) => {
  const id = Number(req.params.id);
  const run = db.select().from(backupRuns).where(eq(backupRuns.id, id)).get();
  if (!run) return res.status(404).json({ error: { code: "not_found", message: "Backup run not found." } });
  if (!run.backupReference) {
    return res.status(410).json({ error: { code: "no_snapshot", message: "This run has no stored snapshot." } });
  }
  const snapshotPath = path.join(run.backupReference, "app.db");
  if (!fs.existsSync(snapshotPath)) {
    return res.status(410).json({ error: { code: "file_missing", message: "Snapshot file is missing on disk." } });
  }

  recordAudit({ actorUserId: req.user!.id, action: "backup_downloaded", entityType: "backup_run", entityId: id });
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="backup-${id}-app.db"`);
  res.sendFile(path.resolve(snapshotPath));
});
