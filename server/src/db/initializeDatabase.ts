import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import Database from "better-sqlite3";
import { sqlite } from "./client.js";

/** Operational CLI that clears the business data so the system can start
 * fresh. Run as:
 *   npm run initialize-db                    wipe everything below
 *   npm run initialize-db -- --keep-contracts  keep Tenants & Landlords, properties,
 *                                            units and contracts (with their pricing,
 *                                            deposit terms, amendments and documents),
 *                                            wipe only what happened under them, and put
 *                                            every contract back to draft
 *
 * Always kept, in both modes: user accounts and sessions, app settings and the
 * backup list. The audit log is wiped in both modes; one entry recording this
 * initialization is added afterwards.
 * Document FILES on disk are never deleted by this script.
 *
 * Like restore-backup, it stops the systemd service, saves a safety copy of
 * the current database first, restarts the service afterwards, and needs a
 * typed confirmation. Deliberately not a web action: it is destructive. */

const DB_PATH = process.env.DATABASE_PATH ?? "./data/app.db";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./storage/backups";
const SERVICE_NAME = process.env.SERVICE_NAME ?? "lcm";
const keepContracts = process.argv.includes("--keep-contracts");

const SERVICE_UNIT_PATH = `/etc/systemd/system/${SERVICE_NAME}.service`;
const manageService = fs.existsSync(SERVICE_UNIT_PATH);

/** What happens under a contract: bills, money received and applied, meter
 * readings, deposit movements and the nightly-run log. */
const ACTIVITY_TABLES = [
  "receipt_allocations",
  "charge_adjustments",
  "deposit_transactions",
  "receipts",
  "charges",
  "usage_entries",
  "billing_runs",
];

/** The contracts, their setup and the parties/properties they hang on. */
const MASTER_DATA_TABLES = [
  "concessions",
  "rate_schedule",
  "pricing_stream_units",
  "pricing_streams",
  "deposit_terms",
  "amendments",
  "contract_versions",
  "billing_rules",
  "contract_units",
  "contracts",
  "documents",
  "party_sensitive_details",
  "parties",
  "user_properties",
  "units",
  "properties",
];

const toDelete = [...ACTIVITY_TABLES, ...(keepContracts ? [] : MASTER_DATA_TABLES), "audit_events"];

function count(table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

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

const counts = toDelete.map((t) => ({ table: t, rows: count(t) }));

console.log("=".repeat(70));
console.log(keepContracts ? "INITIALIZE DATABASE — keeping contracts and Tenants & Landlords" : "INITIALIZE DATABASE — full wipe of business data");
console.log("=".repeat(70));
console.log(`Database : ${DB_PATH}`);
console.log("");
console.log("Will be DELETED:");
for (const c of counts.filter((x) => x.rows > 0)) console.log(`  ${c.table.padEnd(26)} ${c.rows} row(s)`);
if (counts.every((c) => c.rows === 0)) console.log("  (nothing — these tables are already empty)");
console.log("");
console.log("Will be KEPT:");
console.log("  user accounts and sessions, app settings, the backup list");
if (keepContracts) {
  console.log(`  Tenants & Landlords (${count("parties")}), properties (${count("properties")}), units (${count("units")}),`);
  console.log(`  contracts (${count("contracts")}) with their pricing, deposit terms, amendments and documents`);
  console.log("  Every contract is set back to DRAFT and automatic billing is switched OFF.");
}
console.log("");
if (manageService) {
  console.log(`${SERVICE_NAME} will be stopped first and started again automatically afterwards.`);
} else {
  console.log(`No systemd unit found at ${SERVICE_UNIT_PATH} — stop the server yourself before continuing.`);
}
console.log("A safety copy of the current database is saved first, restorable with restore-backup.");
console.log("Document files on disk are NOT deleted.");
console.log("=".repeat(70));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise<string>((resolve) => rl.question('\nType "INITIALIZE" to proceed: ', resolve));
rl.close();

if (answer.trim() !== "INITIALIZE") {
  console.log("Aborted — no changes made.");
  sqlite.close();
  process.exit(1);
}

sqlite.close(); // release our own handle before stopping the service and copying files

try {
  stopService();
} catch (err) {
  console.error(`Failed to stop ${SERVICE_NAME} automatically: ${err}`);
  console.error("Refusing to continue while the server might still be running.");
  process.exit(1);
}

try {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safetyDir = path.join(BACKUP_DIR, `pre-init-${stamp}`);
  fs.mkdirSync(safetyDir, { recursive: true });

  const work = new Database(DB_PATH);
  try {
    // Consistent copy (includes anything still in the WAL), in the same layout
    // restore-backup expects: <folder>/app.db.
    await work.backup(path.join(safetyDir, "app.db"));
    console.log(`Safety copy of the current database saved to: ${safetyDir}`);

    // Foreign keys are switched off for the wipe: rows are removed child-first
    // anyway, but kept users/audit rows may point at things being removed.
    work.pragma("foreign_keys = OFF");
    const wipe = work.transaction(() => {
      for (const table of toDelete) {
        work.prepare(`DELETE FROM ${table}`).run();
        work.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(table);
      }
      if (keepContracts) {
        work.prepare(`UPDATE billing_rules SET auto_billing = 0`).run();
        work.prepare(`UPDATE contracts SET status = 'draft', updated_at = ?`).run(new Date().toISOString());
      }
      work
        .prepare(`INSERT INTO audit_events (actor_user_id, action, entity_type, details_json, created_at) VALUES (NULL, ?, 'database', ?, ?)`)
        .run("database_initialized", JSON.stringify({ keepContracts, deleted: counts.filter((c) => c.rows > 0) }), new Date().toISOString());
    });
    wipe();
    work.pragma("foreign_keys = ON");
    work.exec("VACUUM");
    work.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    work.close();
  }

  console.log("");
  console.log("Database initialized.");
  if (keepContracts) console.log("Next: check each draft contract, activate it, then use Catch up billing on its Charges tab and enter payments.");
} finally {
  try {
    startService();
  } catch (err) {
    console.error(`Initialization finished, but failed to start ${SERVICE_NAME} automatically: ${err}`);
    console.error(`Start it manually: sudo systemctl start ${SERVICE_NAME}`);
  }
}
