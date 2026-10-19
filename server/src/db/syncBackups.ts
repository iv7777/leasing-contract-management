import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { db, sqlite } from "./client.js";
import { backupRuns } from "./schema.js";

/** Brings the Backups list in line with what is actually on disk, and checks
 * that each backup is a working copy. Backups are folders under BACKUP_DIR; if
 * one is deleted by hand, its row would keep showing (and a restore from it
 * would fail). This removes every row whose snapshot is gone, validates the
 * snapshots that remain (valid SQLite file, integrity check, the expected
 * tables, a readable document manifest), marks a backup that fails as Failed
 * with the reason, and reports folders on disk that the list doesn't know.
 * No backup file is touched, and the server can stay running. Run as:
 *   npm run sync-backups */

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? "./storage/backups");
const DOCUMENT_STORAGE_DIR = path.resolve(process.env.DOCUMENT_STORAGE_DIR ?? "./storage/documents");
const REQUIRED_TABLES = ["users", "properties", "contracts", "charges", "receipts", "documents", "backup_runs"];
const VALIDATION_PREFIX = "Validation failed: ";

/** Returns what is wrong with the snapshot in `dir` (null if it is a working
 * copy), plus non-fatal warnings. */
function validateBackup(dir: string): { problem: string | null; warnings: string[] } {
  const warnings: string[] = [];
  const snapshot = path.join(dir, "app.db");
  const size = fs.statSync(snapshot).size;
  if (size === 0) return { problem: "app.db is empty", warnings };

  const fd = fs.openSync(snapshot, "r");
  const header = Buffer.alloc(16);
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (!header.toString("latin1").startsWith("SQLite format 3")) return { problem: "app.db is not a SQLite database", warnings };

  let snap: Database.Database | null = null;
  try {
    snap = new Database(snapshot, { readonly: true, fileMustExist: true });
    const check = snap.pragma("integrity_check") as { integrity_check: string }[];
    if (check.length !== 1 || check[0].integrity_check !== "ok") {
      return { problem: `integrity check failed: ${check.slice(0, 2).map((c) => c.integrity_check).join("; ")}`, warnings };
    }
    const tables = new Set((snap.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length > 0) return { problem: `missing table(s): ${missing.join(", ")}`, warnings };
    snap.prepare("SELECT COUNT(*) FROM users").get(); // actually readable, not just well-formed
    const documentCount = (snap.prepare("SELECT COUNT(*) AS n FROM documents").get() as { n: number }).n;

    const manifestPath = path.join(dir, "documents.manifest.json");
    if (!fs.existsSync(manifestPath)) {
      warnings.push("no documents.manifest.json");
    } else {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (!Array.isArray(manifest)) warnings.push("documents.manifest.json is not a list");
        else {
          if (manifest.length !== documentCount) warnings.push(`manifest lists ${manifest.length} documents, the database ${documentCount}`);
          const gone = manifest.filter((m: { filePath?: string }) => m.filePath && !fs.existsSync(path.join(DOCUMENT_STORAGE_DIR, m.filePath))).length;
          if (gone > 0) warnings.push(`${gone} referenced document file(s) are missing from storage`);
        }
      } catch {
        warnings.push("documents.manifest.json is unreadable");
      }
    }
    return { problem: null, warnings };
  } catch (err) {
    return { problem: `cannot be opened: ${err instanceof Error ? err.message : String(err)}`, warnings };
  } finally {
    snap?.close();
  }
}

const rows = db.select().from(backupRuns).all();
const removed: typeof rows = [];
const invalid: { id: number; startedAt: string; reason: string }[] = [];
const recovered: number[] = [];
const warned: { id: number; startedAt: string; warnings: string[] }[] = [];
let good = 0;
let kept = 0;

for (const r of rows) {
  // Rows that never produced a snapshot (a failed run, or one still running) have nothing to check.
  if (!r.backupReference) {
    kept++;
    continue;
  }
  if (!fs.existsSync(path.join(r.backupReference, "app.db"))) {
    db.delete(backupRuns).where(eq(backupRuns.id, r.id)).run();
    removed.push(r);
    continue;
  }
  kept++;
  // Check the copies that claim to be good, and re-check ones an earlier run marked bad.
  const previouslyBad = r.status === "failed" && (r.error ?? "").startsWith(VALIDATION_PREFIX);
  if (r.status !== "succeeded" && !previouslyBad) continue;

  process.stdout.write(`  checking #${r.id} (${r.startedAt}) ... `);
  const { problem, warnings } = validateBackup(r.backupReference);
  if (problem) {
    console.log(`PROBLEM: ${problem}`);
    db.update(backupRuns).set({ status: "failed", error: VALIDATION_PREFIX + problem }).where(eq(backupRuns.id, r.id)).run();
    invalid.push({ id: r.id, startedAt: r.startedAt, reason: problem });
  } else {
    console.log(warnings.length ? "ok (with warnings)" : "ok");
    good++;
    if (previouslyBad) {
      db.update(backupRuns).set({ status: "succeeded", error: null }).where(eq(backupRuns.id, r.id)).run();
      recovered.push(r.id);
    }
    if (warnings.length) warned.push({ id: r.id, startedAt: r.startedAt, warnings });
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

console.log(`\nBackup folder: ${BACKUP_DIR}`);
console.log(`${kept} backup entr${kept === 1 ? "y" : "ies"} with a folder on disk; ${good} verified as working copies.`);
if (removed.length === 0) {
  console.log("Nothing to remove — every listed backup folder still exists.");
} else {
  console.log(`\nRemoved ${removed.length} entr${removed.length === 1 ? "y" : "ies"} whose backup folder no longer exists:`);
  for (const r of removed) {
    console.log(`  #${r.id}  ${r.kind}  ${r.startedAt}${r.pinned ? "  (was marked permanent)" : ""}${r.comment ? `  — ${r.comment}` : ""}`);
  }
}
if (invalid.length > 0) {
  console.log(`\n${invalid.length} backup(s) are NOT working copies and are now marked Failed (cannot be restored):`);
  for (const i of invalid) console.log(`  #${i.id}  ${i.startedAt}  — ${i.reason}`);
}
if (recovered.length > 0) console.log(`\nBackup(s) now verified again and marked successful: ${recovered.map((i) => `#${i}`).join(", ")}`);
if (warned.length > 0) {
  console.log("\nWarnings (the database copy itself is fine):");
  for (const w of warned) console.log(`  #${w.id}  ${w.startedAt}  — ${w.warnings.join("; ")}`);
}
if (unlisted.length > 0) {
  console.log(`\n${unlisted.length} backup folder(s) on disk are not in the list (left as they are):`);
  for (const dir of unlisted) console.log(`  ${dir}`);
}
sqlite.close();
