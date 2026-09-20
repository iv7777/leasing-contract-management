import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { db, sqlite } from "./client.js";
import { backupRuns } from "./schema.js";

/** Operational CLI for restoring the database from a snapshot taken by
 * runBackup() (src/jobs/backup.ts). This only touches the SQLite database —
 * document files under DOCUMENT_STORAGE_DIR are never modified by it; recover
 * those separately using documents.manifest.json in the backup folder if
 * needed. Deliberately not exposed as a one-click web action: swapping the
 * live database out from under a running server is destructive and easy to
 * get wrong, so this stays a server-shell operation with an explicit typed
 * confirmation. Run as:
 *   npm run restore-backup -- <backupRunId | path-to-backup-dir> */

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./storage/backups";
const SERVICE_NAME = process.env.SERVICE_NAME ?? "lcm";

// Only manage the systemd unit if it's actually installed (the vps-deploy.sh
// path) — in a dev checkout or a differently-managed deployment there's
// nothing to stop/start, and we shouldn't pretend otherwise.
const SERVICE_UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;
const manageService = fs.existsSync(SERVICE_UNIT_PATH);

function stopService() {
  if (!manageService) return;
  console.log(`Stopping ${SERVICE_NAME}...`);
  execSync(`systemctl stop ${SERVICE_NAME}`, { stdio: "inherit" });
}

function startService() {
  if (!manageService) return;
  console.log(`Starting ${SERVICE_NAME}...`);
  execSync(`systemctl start ${SERVICE_NAME}`, { stdio: "inherit" });
}

/** A run's own snapshot always freezes its backup_runs row as "running" —
 * the row's "succeeded" update happens after the snapshot file is already
 * written to disk, so the file can never contain it (see backup.ts). Restore
 * proves the file is a complete, valid snapshot regardless, so once it's in
 * place we can safely correct that one row in the now-live database. */
function fixSelfReferentialRunStatus(restoredBackupDir: string) {
  const stampFromDir = path.basename(restoredBackupDir);
  const patchDb = new Database(DB_PATH);
  try {
    const stuckRuns = patchDb
      .prepare(`SELECT id, started_at FROM backup_runs WHERE status = 'running'`)
      .all() as { id: number; started_at: string }[];
    const match = stuckRuns.find((r) => r.started_at.replace(/[:.]/g, "-") === stampFromDir);
    if (!match) return;

    let manifestCount: number | null = null;
    const manifestPath = path.join(restoredBackupDir, "documents.manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (Array.isArray(parsed)) manifestCount = parsed.length;
      } catch {
        // manifest unreadable — leave includedDocumentCount as-is below
      }
    }

    patchDb
      .prepare(
        `UPDATE backup_runs
         SET status = 'succeeded', completed_at = ?, backup_reference = ?,
             included_document_count = COALESCE(?, included_document_count), error = NULL
         WHERE id = ?`
      )
      .run(new Date().toISOString(), restoredBackupDir, manifestCount, match.id);
    console.log(
      `Corrected backup run ${match.id}'s own status from "running" to "succeeded" ` +
        `(it can never see its own completion — see the comment in backup.ts).`
    );
  } finally {
    patchDb.close();
  }
}

const [, , target] = process.argv;
if (!target) {
  console.error("Usage: npm run restore-backup -- <backupRunId | path-to-backup-dir>");
  process.exit(1);
}

function resolveBackupDir(): string {
  if (/^\d+$/.test(target)) {
    const run = db.select().from(backupRuns).where(eq(backupRuns.id, Number(target))).get();
    if (!run) {
      console.error(`No backup run found with id ${target}.`);
      process.exit(1);
    }
    if (run.status !== "succeeded") {
      console.error(`Backup run ${target} did not succeed (status: ${run.status}) — refusing to restore from it.`);
      process.exit(1);
    }
    if (!run.backupReference) {
      console.error(`Backup run ${target} has no recorded snapshot location.`);
      process.exit(1);
    }
    return run.backupReference;
  }
  return target;
}

const backupDir = resolveBackupDir();
const snapshotPath = path.join(backupDir, "app.db");
if (!fs.existsSync(snapshotPath)) {
  console.error(`No app.db snapshot found at ${snapshotPath}.`);
  process.exit(1);
}

console.log("=".repeat(70));
console.log("DATABASE RESTORE");
console.log("=".repeat(70));
console.log(`Restoring from : ${snapshotPath}`);
console.log(`Restoring to   : ${DB_PATH}`);
console.log("");
if (manageService) {
  console.log(`${SERVICE_NAME} will be stopped automatically before the restore and`);
  console.log("started again automatically once it finishes (or fails).");
} else {
  console.log(`No systemd unit found at ${SERVICE_UNIT_PATH} — this script cannot stop`);
  console.log("the server for you. Make sure it's STOPPED before continuing, otherwise");
  console.log("the running process may keep writing to the old database file underneath");
  console.log("this restore, and your restore could be lost or the file left corrupted.");
}
console.log("");
console.log("This will:");
console.log("  1. Save a safety copy of the CURRENT database before touching anything.");
console.log(`  2. Replace ${DB_PATH} with the selected snapshot.`);
console.log("  3. Discard any -wal/-shm files alongside it (they belong to the old data).");
console.log("");
console.log("Document files under DOCUMENT_STORAGE_DIR are NOT touched by this");
console.log("script — only the database itself.");
console.log("=".repeat(70));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise<string>((resolve) => rl.question('\nType "RESTORE" to proceed: ', resolve));
rl.close();

if (answer.trim() !== "RESTORE") {
  console.log("Aborted — no changes made.");
  sqlite.close();
  process.exit(1);
}

sqlite.close(); // release our own handle before touching files on disk

try {
  stopService();
} catch (err) {
  console.error(`Failed to stop ${SERVICE_NAME} automatically: ${err}`);
  console.error("Refusing to restore while the server might still be running.");
  console.error(`Stop it manually (sudo systemctl stop ${SERVICE_NAME}) and re-run this command.`);
  process.exit(1);
}

try {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyDir = path.join(BACKUP_DIR, `pre-restore-${stamp}`);
  fs.mkdirSync(safetyDir, { recursive: true });
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, path.join(safetyDir, "app.db"));
  for (const suffix of ["-wal", "-shm"]) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(safetyDir, "app.db" + suffix));
  }
  console.log(`Safety copy of the current database saved to: ${safetyDir}`);

  fs.copyFileSync(snapshotPath, DB_PATH);
  for (const suffix of ["-wal", "-shm"]) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  fixSelfReferentialRunStatus(backupDir);

  console.log("");
  console.log("Restore complete.");
} finally {
  try {
    startService();
  } catch (err) {
    console.error(`Restore finished, but failed to start ${SERVICE_NAME} automatically: ${err}`);
    console.error(`Start it manually: sudo systemctl start ${SERVICE_NAME}`);
  }
}
