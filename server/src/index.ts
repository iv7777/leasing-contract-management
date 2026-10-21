import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import cron from "node-cron";
import { attachUser } from "./middleware/auth.js";
import { SqliteSessionStore } from "./lib/sqliteSessionStore.js";
import { authRouter } from "./routes/auth.js";
import { propertiesRouter } from "./routes/properties.js";
import { partiesRouter } from "./routes/parties.js";
import { usersRouter } from "./routes/users.js";
import { documentsRouter } from "./routes/documents.js";
import { contractsRouter } from "./routes/contracts.js";
import { amendmentsRouter } from "./routes/amendments.js";
import { receiptsRouter } from "./routes/receipts.js";
import { depositTransactionsRouter } from "./routes/depositTransactions.js";
import { usageEntriesRouter } from "./routes/usageEntries.js";
import { reportsRouter } from "./routes/reports.js";
import { exportsRouter } from "./routes/exports.js";
import { systemInfoRouter } from "./routes/systemInfo.js";
import { auditRouter } from "./routes/audit.js";
import { backupsRouter } from "./routes/backups.js";
import { systemHealthRouter } from "./routes/systemHealth.js";
import { billingRouter } from "./routes/billing.js";
import { paymentsRouter } from "./routes/payments.js";
import { runDailyBilling } from "./jobs/billing.js";
import { runContractLifecycle } from "./jobs/contractLifecycle.js";
import { runBackup, countSucceededRuns, isWeeklyBackupDue, DAILY_RETENTION_LIMIT } from "./jobs/backup.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  }),
);
app.use((req, res, next) => {
  // Browsers must not sniff, frame or cache what the API returns.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=15552000");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use(
  session({
    name: "lcm.sid",
    secret: process.env.SESSION_SECRET ?? "dev-only-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: new SqliteSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000, // 12h
    },
  }),
);
app.use(attachUser);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/parties", partiesRouter);
app.use("/api/users", usersRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/contracts", contractsRouter);
app.use("/api", amendmentsRouter);
app.use("/api", receiptsRouter);
app.use("/api", depositTransactionsRouter);
app.use("/api", usageEntriesRouter);
app.use("/api", billingRouter);
app.use("/api", paymentsRouter);
app.use("/api", reportsRouter);
app.use("/api", exportsRouter);
app.use("/api/system-info", systemInfoRouter);
app.use("/api/audit", auditRouter);
app.use("/api/backups", backupsRouter);
app.use("/api/system-health", systemHealthRouter);

// Anything under /api that no route handled.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Not found." } });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const e = err as { type?: string; status?: number; code?: string } | null;
  // The caller's mistakes are the caller's to fix: report them plainly instead of as a server fault.
  if (e?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "invalid_json", message: "The request could not be read." } });
  if (e?.type === "entity.too.large") return res.status(413).json({ error: { code: "too_large", message: "The request is too large." } });
  if (e?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: { code: "file_too_large", message: "That file is too large. The limit is 50 MB." } });
  if (typeof e?.code === "string" && e.code.startsWith("LIMIT_")) return res.status(400).json({ error: { code: "invalid_upload", message: "Invalid document upload payload." } });
  if (e?.code === "SQLITE_CONSTRAINT_UNIQUE" || e?.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return res.status(409).json({ error: { code: "already_exists", message: "That already exists." } });
  }
  if (e?.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return res.status(400).json({ error: { code: "invalid_reference", message: "A record this refers to does not exist." } });
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Unexpected server error." } });
});

if (process.env.ENABLE_BACKUP_SCHEDULE === "true") {
  // Daily backup at 02:15 China time, independent of the host's local TZ.
  // Retained up to DAILY_RETENTION_LIMIT copies — older ones are pruned
  // automatically after each successful run (see jobs/backup.ts).
  cron.schedule("15 2 * * *", () => {
    runBackup("daily").catch((err) => console.error("Scheduled daily backup failed:", err));
  }, { timezone: "Asia/Shanghai" });

  // Weekly backup at Sunday 00:00 China time — but only once the daily
  // rotation is full (isWeeklyBackupDue), since before that a weekly copy
  // wouldn't preserve anything a daily one doesn't already cover for at
  // least as long. Also retained/pruned independently, up to 30 copies.
  cron.schedule("0 0 * * 0", () => {
    const dailyCount = countSucceededRuns("daily");
    if (!isWeeklyBackupDue(dailyCount)) {
      console.log(`Skipping weekly backup — only ${dailyCount}/${DAILY_RETENTION_LIMIT} daily backups so far.`);
      return;
    }
    runBackup("weekly").catch((err) => console.error("Scheduled weekly backup failed:", err));
  }, { timezone: "Asia/Shanghai" });
}

// Nightly billing at 03:00 China time (after the 02:15 backup). On by default
// because it only touches contracts an Admin has explicitly switched to
// automatic billing via "catch up billing"; set =false to turn the job off.
if (process.env.ENABLE_CHARGE_GENERATION_SCHEDULE !== "false") {
  cron.schedule("0 3 * * *", () => {
    try {
      const r = runDailyBilling("scheduled");
      console.log(`Nightly billing: ${r.chargesCreated} charge(s) across ${r.contractsProcessed} contract(s), ${r.contractsFailed} failed, ${r.missingReadings} missing reading(s).`);
    } catch (err) {
      console.error("Nightly billing failed:", err);
    }
  }, { timezone: "Asia/Shanghai" });
}

// Nightly status pass at 03:05 China time, right after billing so a contract
// that ended yesterday still gets its last billing run before it is marked
// expired. Independent of the billing switch. Also run once at start-up so a
// restart after downtime catches up straight away.
function runLifecycle() {
  try {
    const r = runContractLifecycle();
    if (r.expired > 0 || r.statusChanged > 0) console.log(`Contract status pass: ${r.expired} expired, ${r.statusChanged} changed by amendment.`);
  } catch (err) {
    console.error("Contract status pass failed:", err);
  }
}
cron.schedule("5 3 * * *", runLifecycle, { timezone: "Asia/Shanghai" });
runLifecycle();

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
