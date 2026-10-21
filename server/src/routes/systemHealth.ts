import fs from "node:fs";
import { Router } from "express";
import { desc } from "drizzle-orm";
import { db, sqlite } from "../db/client.js";
import { backupRuns, documents } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { recordAudit } from "../lib/audit.js";
import { ownerExists } from "./documents.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ownerLabel } from "../lib/auditDetail.js";
import { findOrphanFiles, sha256File } from "../lib/storageScan.js";

const STORAGE_DIR = process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./storage/backups";

// Read-only checks: nothing here changes data or files.
export const systemHealthRouter = Router();
systemHealthRouter.use(requireAuth, requireRole("admin"));

function describe(d: typeof documents.$inferSelect) {
  return {
    id: d.id,
    ownerType: d.ownerType,
    ownerId: d.ownerId,
    owner: ownerLabel(d.ownerType, d.ownerId),
    name: d.name,
    docType: d.docType,
    voided: d.voided,
  };
}

/** Document records whose file is gone, and files on disk that no record uses. */
systemHealthRouter.get("/files", (_req, res) => {
  const all = db.select().from(documents).all();
  // A record whose owner (reading, contract, ...) no longer exists can't be reached from any screen.
  const ownerless = all.filter((d) => !ownerExists(d.ownerType, d.ownerId));
  const ownerlessIds = new Set(ownerless.map((d) => d.id));
  const missing = all.filter((d) => !ownerlessIds.has(d.id) && !fs.existsSync(d.filePath)).map(describe);
  const orphans = findOrphanFiles(STORAGE_DIR, all.map((d) => d.filePath));
  res.json({ documentCount: all.length, missing, orphans, ownerless: ownerless.map((d) => ({ ...describe(d), fileMissing: !fs.existsSync(d.filePath) })) });
});

/** Removes a document record whose owner no longer exists, with its file. Refused while the owner exists. */
systemHealthRouter.delete("/documents/:id", (req, res) => {
  const id = Number(req.params.id);
  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found." } });
  if (ownerExists(doc.ownerType, doc.ownerId)) {
    return res.status(409).json({ error: { code: "owner_exists", message: "This document still belongs to an existing record. Remove it from there." } });
  }
  db.delete(documents).where(eq(documents.id, id)).run();
  try {
    fs.unlinkSync(doc.filePath);
  } catch {
    // The file was already gone.
  }
  recordAudit({ actorUserId: req.user!.id, action: "document_deleted", entityType: "document", entityId: id, details: { ownerType: doc.ownerType, docType: doc.docType, name: doc.name, ownerWasGone: true } });
  res.status(204).send();
});

/** Re-hashes every stored file against the checksum recorded at upload. Slow on a big archive. */
systemHealthRouter.post("/checksums", async (_req, res) => {
  const all = db.select().from(documents).all();
  const mismatched: ReturnType<typeof describe>[] = [];
  let checked = 0;
  let skippedMissing = 0;
  for (const d of all) {
    if (!fs.existsSync(d.filePath)) {
      skippedMissing += 1;
      continue;
    }
    checked += 1;
    try {
      if ((await sha256File(d.filePath)) !== d.checksumSha256) mismatched.push(describe(d));
    } catch {
      mismatched.push(describe(d));
    }
  }
  res.json({ checked, skippedMissing, mismatched });
});

/** SQLite's own integrity and foreign-key checks. */
systemHealthRouter.get("/database", (_req, res) => {
  const integrity = (sqlite.pragma("integrity_check") as { integrity_check: string }[]).map((r) => r.integrity_check);
  const fkRows = sqlite.pragma("foreign_key_check") as { table: string; rowid: number | null; parent: string }[];
  res.json({
    integrityOk: integrity.length === 1 && integrity[0] === "ok",
    integrity,
    foreignKeyViolations: fkRows.slice(0, 100).map((r) => ({ table: r.table, rowid: r.rowid, parent: r.parent })),
    foreignKeyViolationCount: fkRows.length,
  });
});

function disk(dir: string): { freeBytes: number; totalBytes: number } | null {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const s = fs.statfsSync(dir);
    return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
  } catch {
    return null;
  }
}

/** Latest successful backup, and free space where documents and backups are kept. */
systemHealthRouter.get("/storage", (_req, res) => {
  const runs = db.select().from(backupRuns).orderBy(desc(backupRuns.id)).limit(50).all();
  const last = runs.find((r) => r.status === "succeeded") ?? null;
  const latest = runs[0] ?? null;
  res.json({
    lastSuccessfulBackup: last ? { startedAt: last.startedAt, completedAt: last.completedAt, kind: last.kind } : null,
    latestRunStatus: latest ? latest.status : null,
    documents: disk(STORAGE_DIR),
    backups: disk(BACKUP_DIR),
  });
});
