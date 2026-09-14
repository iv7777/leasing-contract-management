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
import { reportsRouter } from "./routes/reports.js";
import { exportsRouter } from "./routes/exports.js";
import { systemInfoRouter } from "./routes/systemInfo.js";
import { auditRouter } from "./routes/audit.js";
import { runBackup } from "./jobs/backup.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());
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
app.use("/api", reportsRouter);
app.use("/api", exportsRouter);
app.use("/api/system-info", systemInfoRouter);
app.use("/api/audit", auditRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Unexpected server error." } });
});

if (process.env.ENABLE_BACKUP_SCHEDULE === "true") {
  // Daily backup at 02:15 China time, independent of the host's local TZ.
  cron.schedule("15 2 * * *", () => {
    runBackup().catch((err) => console.error("Scheduled backup failed:", err));
  }, { timezone: "Asia/Shanghai" });
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
