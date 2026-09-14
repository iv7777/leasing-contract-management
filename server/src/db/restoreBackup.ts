import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
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
console.log("Make sure the server is STOPPED before continuing:");
console.log(`    sudo systemctl stop ${SERVICE_NAME}`);
console.log("Otherwise the running process may keep writing to the old database");
console.log("file underneath this restore, and your restore could be lost or the");
console.log("file left corrupted.");
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

console.log("");
console.log("Restore complete. Start the server again:");
console.log(`    sudo systemctl start ${SERVICE_NAME}`);
