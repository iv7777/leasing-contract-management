import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { db, sqlite } from "../db/client.js";
import { backupRuns, documents } from "../db/schema.js";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./storage/backups";
const DOCUMENT_STORAGE_DIR = process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents";

/** Daily backup: a consistent SQLite snapshot (via the native backup API,
 * safe to run against a live WAL database) plus a manifest of every
 * referenced document so a restore can verify nothing is missing. Off-site
 * copy and long-term retention pruning are operational steps layered on top
 * of this once a hosting/backup destination is chosen (brief §13). */
export async function runBackup(): Promise<{ backupDir: string; documentCount: number }> {
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const runDir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(runDir, { recursive: true });

  const run = db.insert(backupRuns).values({ startedAt, status: "running" }).returning().get();

  try {
    const allDocuments = db.select().from(documents).all();
    const manifest = allDocuments.map((d) => ({
      id: d.id,
      ownerType: d.ownerType,
      ownerId: d.ownerId,
      filePath: path.relative(DOCUMENT_STORAGE_DIR, d.filePath),
      checksumSha256: d.checksumSha256,
      sizeBytes: d.sizeBytes,
    }));
    fs.writeFileSync(path.join(runDir, "documents.manifest.json"), JSON.stringify(manifest, null, 2));

    let missing = 0;
    for (const d of allDocuments) {
      if (!fs.existsSync(d.filePath)) missing++;
    }

    // Finalize this run's own row BEFORE taking the snapshot below. sqlite's
    // online backup API copies whatever is committed at the moment it's
    // called; anything written to the live db afterward — including this
    // row's own "succeeded" update — can never appear in a file that's
    // already been written to disk. Finalizing first means a run's snapshot
    // correctly shows itself as complete instead of forever "running" (the
    // symptom if you ever restore straight onto a run's own snapshot).
    const status = missing === 0 ? "succeeded" : "failed";
    const error = missing > 0 ? `${missing} referenced document(s) missing from storage.` : null;
    db.update(backupRuns)
      .set({
        completedAt: new Date().toISOString(),
        status,
        backupReference: runDir,
        includedDocumentCount: allDocuments.length,
        error,
      })
      .where(eq(backupRuns.id, run.id))
      .run();

    const snapshotPath = path.join(runDir, "app.db");
    await sqlite.backup(snapshotPath);

    if (missing > 0) {
      throw new Error(`Backup completed with ${missing} missing document(s); see backup_runs.`);
    }

    return { backupDir: runDir, documentCount: allDocuments.length };
  } catch (err) {
    db.update(backupRuns)
      .set({ completedAt: new Date().toISOString(), status: "failed", error: String(err) })
      .where(eq(backupRuns.id, run.id))
      .run();
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup()
    .then((r) => {
      console.log(`Backup succeeded: ${r.backupDir} (${r.documentCount} documents referenced).`);
      sqlite.close();
    })
    .catch((err) => {
      console.error("Backup failed:", err);
      sqlite.close();
      process.exit(1);
    });
}
