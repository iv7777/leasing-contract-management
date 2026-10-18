import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { backupRuns } from "../db/schema.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { recordAudit } from "../lib/audit.js";
import { pruneAllKinds, runBackup } from "../jobs/backup.js";

export const backupsRouter = Router();
backupsRouter.use(requireAuth, requireRole("admin"));

function snapshotBytes(dir: string | null): number {
  if (!dir) return 0;
  try {
    return fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
  } catch {
    return 0;
  }
}

backupsRouter.get("/", (_req, res) => {
  // Permanent backups are always listed, even when older than the newest 100 runs.
  const recent = db.select().from(backupRuns).orderBy(desc(backupRuns.id)).limit(100).all();
  const permanent = db.select().from(backupRuns).where(eq(backupRuns.pinned, true)).all();
  const byId = new Map([...recent, ...permanent].map((r) => [r.id, r]));
  const runs = Array.from(byId.values()).sort((a, b) => b.id - a.id);
  res.json({
    runs,
    permanent: { count: permanent.length, sizeBytes: permanent.reduce((sum, r) => sum + snapshotBytes(r.backupReference), 0) },
  });
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

const pinSchema = z.object({ pinned: z.boolean() });

backupsRouter.patch("/:id/pin", (req, res) => {
  const id = Number(req.params.id);
  const parsed = pinSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    return res.status(400).json({ error: { code: "validation_error", message: "pinned must be true or false." } });
  }
  const run = db.select().from(backupRuns).where(eq(backupRuns.id, id)).get();
  if (!run) return res.status(404).json({ error: { code: "not_found", message: "Backup run not found." } });
  if (parsed.data.pinned && (run.status !== "succeeded" || !run.backupReference)) {
    return res.status(409).json({ error: { code: "not_pinnable", message: "Only a successful backup with a stored snapshot can be made permanent." } });
  }

  db.update(backupRuns).set({ pinned: parsed.data.pinned }).where(eq(backupRuns.id, id)).run();
  let removed = false;
  if (!parsed.data.pinned) {
    // Rejoining the rotation: if it is now beyond the limit it goes right away.
    pruneAllKinds();
    removed = !db.select({ id: backupRuns.id }).from(backupRuns).where(eq(backupRuns.id, id)).get();
  }
  recordAudit({ actorUserId: req.user!.id, action: parsed.data.pinned ? "backup_pinned" : "backup_unpinned", entityType: "backup_run", entityId: id, details: { removed } });
  res.json({ id, pinned: parsed.data.pinned, removed });
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
