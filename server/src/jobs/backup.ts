import fs from "node:fs";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { db, sqlite } from "../db/client.js";
import { backupRuns, documents } from "../db/schema.js";
import { type BackupKind, DAILY_RETENTION_LIMIT, WEEKLY_RETENTION_LIMIT, selectRunsToPrune } from "./backupRetention.js";

export type { BackupKind } from "./backupRetention.js";
export { isWeeklyBackupDue, DAILY_RETENTION_LIMIT, WEEKLY_RETENTION_LIMIT } from "./backupRetention.js";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./storage/backups";
const DOCUMENT_STORAGE_DIR = process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents";

export function countSucceededRuns(kind: BackupKind): number {
  return db
    .select({ id: backupRuns.id })
    .from(backupRuns)
    .where(and(eq(backupRuns.kind, kind), eq(backupRuns.status, "succeeded")))
    .all().length;
}

/** Deletes a pruned run's on-disk snapshot directory (if still present) and
 * its backup_runs row. Only ever called on runs already past this kind's
 * retention limit — never the run currently being created. */
function deleteBackupRun(run: { id: number; backupReference: string | null }) {
  if (run.backupReference && fs.existsSync(run.backupReference)) {
    fs.rmSync(run.backupReference, { recursive: true, force: true });
  }
  db.delete(backupRuns).where(eq(backupRuns.id, run.id)).run();
}

function pruneOldRuns(kind: BackupKind, retentionLimit: number): number {
  const runs = db
    .select({ id: backupRuns.id, backupReference: backupRuns.backupReference })
    .from(backupRuns)
    .where(and(eq(backupRuns.kind, kind), eq(backupRuns.status, "succeeded")))
    .orderBy(asc(backupRuns.id))
    .all();
  const toPrune = selectRunsToPrune(
    runs.map((r) => r.id),
    retentionLimit,
  );
  for (const id of toPrune) {
    deleteBackupRun(runs.find((r) => r.id === id)!);
  }
  return toPrune.length;
}

/** Takes a consistent SQLite snapshot (via the native backup API, safe to
 * run against a live WAL database) plus a manifest of every referenced
 * document so a restore can verify nothing is missing, then prunes old runs
 * of the same kind beyond its retention limit (DAILY_RETENTION_LIMIT /
 * WEEKLY_RETENTION_LIMIT — both 30, kept and pruned independently). Pruning
 * only runs after a successful backup, and only deletes runs already over
 * the limit — never the one just taken. Off-site copy is still an
 * operational step layered on top of this once a destination is chosen
 * (brief §13); note that syncing it with `rclone sync` would mirror this
 * pruning off-site too — use `rclone copy` there instead if the off-site
 * archive should outlive local retention. */
export async function runBackup(kind: BackupKind = "daily"): Promise<{ backupDir: string; documentCount: number }> {
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const runDir = path.join(BACKUP_DIR, stamp);
  fs.mkdirSync(runDir, { recursive: true });

  const run = db.insert(backupRuns).values({ startedAt, status: "running", kind }).returning().get();

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

    // Rotate only after a confirmed success — a failed run leaves existing
    // backups of this kind untouched rather than risk pruning down to fewer
    // than the retention limit while today's copy is in a bad state.
    const retentionLimit = kind === "daily" ? DAILY_RETENTION_LIMIT : WEEKLY_RETENTION_LIMIT;
    const pruned = pruneOldRuns(kind, retentionLimit);
    if (pruned > 0) {
      console.log(`Pruned ${pruned} ${kind} backup(s) beyond the ${retentionLimit}-copy retention limit.`);
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
  const [, , kindArg] = process.argv;
  if (kindArg && kindArg !== "daily" && kindArg !== "weekly") {
    console.error(`Usage: npm run backup -- [daily|weekly]  (got "${kindArg}")`);
    process.exit(1);
  }
  runBackup((kindArg as BackupKind) ?? "daily")
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
