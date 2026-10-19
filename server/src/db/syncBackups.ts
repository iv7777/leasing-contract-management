import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, sqlite } from "./client.js";
import { backupRuns } from "./schema.js";

/** Brings the Backups list in line with what is actually on disk. Backups are
 * folders under BACKUP_DIR; if one is deleted by hand, its row would keep
 * showing (and a restore from it would fail). This removes every row whose
 * snapshot is gone, and reports folders on disk that the list doesn't know.
 * Nothing on disk is touched, and the server can stay running. Run as:
 *   npm run sync-backups */

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? "./storage/backups");

const rows = db.select().from(backupRuns).all();
const removed: typeof rows = [];
let kept = 0;

for (const r of rows) {
  // Rows that never produced a snapshot (a failed run, or one still running) have nothing to check.
  if (!r.backupReference) {
    kept++;
    continue;
  }
  const snapshot = path.join(r.backupReference, "app.db");
  if (fs.existsSync(snapshot)) {
    kept++;
  } else {
    db.delete(backupRuns).where(eq(backupRuns.id, r.id)).run();
    removed.push(r);
  }
}

// Folders that hold a snapshot but have no row (e.g. after restoring an older database).
const listed = new Set(rows.filter((r) => r.backupReference).map((r) => path.resolve(r.backupReference!)));
const unlisted = fs.existsSync(BACKUP_DIR)
  ? fs
      .readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("pre-restore-") && !d.name.startsWith("pre-init-"))
      .map((d) => path.join(BACKUP_DIR, d.name))
      .filter((dir) => fs.existsSync(path.join(dir, "app.db")) && !listed.has(path.resolve(dir)))
  : [];

console.log(`Backup folder: ${BACKUP_DIR}`);
console.log(`${kept} backup(s) still on disk and listed.`);
if (removed.length === 0) {
  console.log("Nothing to remove — every listed backup still exists.");
} else {
  console.log(`Removed ${removed.length} entr${removed.length === 1 ? "y" : "ies"} whose backup folder no longer exists:`);
  for (const r of removed) {
    console.log(`  #${r.id}  ${r.kind}  ${r.startedAt}${r.pinned ? "  (was marked permanent)" : ""}${r.comment ? `  — ${r.comment}` : ""}`);
  }
}
if (unlisted.length > 0) {
  console.log(`\n${unlisted.length} backup folder(s) on disk are not in the list (left as they are):`);
  for (const dir of unlisted) console.log(`  ${dir}`);
}
sqlite.close();
