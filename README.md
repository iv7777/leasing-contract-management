# Lease Contract Management

A web app for managing ~100 factory/property lease contracts across China, with an owner working remotely from the US.

**Deploying to a VPS?** See [`docs/deployment-guide.html`](docs/deployment-guide.html) (open it in a browser) for a full Ubuntu 24.04 walkthrough, or run [`deploy/vps-deploy.sh`](deploy/vps-deploy.sh) for an automated root-based install/redeploy.

## Stack

- **Backend**: Node.js / Express / TypeScript, SQLite via Drizzle ORM (`better-sqlite3`), session-based auth
- **Frontend**: React + Vite + TypeScript, Ant Design v5, `react-i18next` (English / Chinese), mobile-responsive
- **Money**: integer fen only, `decimal.js` for intermediate math — never floating point
- **Dates**: plain ISO calendar dates for lease/due dates (no implicit timezone shift for the US-based owner); audit timestamps in UTC, displayed in Asia/Shanghai by default

## Monorepo layout

```
shared/   money/date utilities and shared types used by both server and web
server/   Express API, Drizzle schema + migrations, auth, documents, backups
web/      React + Ant Design frontend
```

## Getting started

```bash
npm install
npm run build:shared

cp server/.env.example server/.env   # edit SESSION_SECRET before any real use
npm run migrate
npm run seed                          # creates an initial admin user (see server/.env)

npm run dev:server                    # http://localhost:4000
npm run dev:web                       # http://localhost:5173 (proxies /api to the server)
```

## Backups

```bash
npm run backup --workspace=server              # daily (default)
npm run backup --workspace=server -- weekly    # weekly
```

Writes a consistent SQLite snapshot plus a manifest of every referenced document under `server/storage/backups/<timestamp>/`. Set `ENABLE_BACKUP_SCHEDULE=true` in `server/.env` to also run this automatically via the running server process: daily at 02:15 Asia/Shanghai time, and weekly at Sunday 00:00 Asia/Shanghai — but the weekly job only actually takes a backup once the daily rotation is full (`isWeeklyBackupDue` in `server/src/jobs/backupRetention.ts`); before that a weekly copy wouldn't preserve anything a same-age daily copy doesn't already cover for at least as long.

**Retention is automatic**: each kind keeps its most recent 30 successful runs and prunes older ones (both the on-disk snapshot directory and the `backup_runs` row) right after a successful backup of that kind — daily and weekly are counted and pruned independently, so one never crowds out the other. Pruning only runs after a confirmed success, so a failed backup never triggers cleanup of otherwise-good ones. Restore-time safety copies (`storage/backups/pre-restore-*`, made automatically by `restore-backup` below) are **not** covered by this retention policy and accumulate until removed by hand.

Restoring: use `deploy/vps-deploy.sh`'s control-panel menu ("Restore the database from a backup", or `--restore-backup`) if you deployed with it — it scans `BACKUP_DIR`, validates each snapshot (SQLite header, and a `PRAGMA integrity_check` when `sqlite3` is available), and lets you pick one. Otherwise, on the server directly:

```bash
cd server && npm run restore-backup -- <backup ID | path-to-backup-dir>
```

Either way, the systemd service (if present) is stopped and restarted automatically around the restore, and a safety copy of the current database is saved first. Document files under `DOCUMENT_STORAGE_DIR` are never touched by a restore — recover those separately from `documents.manifest.json` in the backup folder if needed.

An off-site copy outside China and a documented restore drill are required before production use per the project brief — neither is automated yet. If you set one up with `rclone`, prefer `rclone copy` over `rclone sync`: since local retention now prunes on its own, a `sync` would mirror those deletions off-site too, defeating the point of a separate off-site archive.

## Delivery phases

- **Phase 1 — Foundation** (done): authentication, roles (Admin/Manager/Collector/Viewer), property/unit inventory, tenant/landlord records (with Admin-only sensitive identity details), private classified document storage, append-only audit logging, backup/restore.
- **Phase 2 — Agreements and calculation** (done): contracts, contract units, pricing streams (per-unit, grouped, or contract-wide), rate schedules (flat / per-sqm / percentage escalation), free-rent and discount concessions, deposit terms, the charge-generation engine (`server/src/billing`), and the amendment workflow (draft → pending → approved, with staleness checks and a `contract_versions` snapshot on every approval).
- **Phase 3 — Collection pilot** (done): receipts, allocations with over-allocation guards on both the receipt and the charge, unallocated credit, reversals (append-only — nothing is edited or deleted), a deposit ledger (receipt/refund/deduction/transfer-to-rent, refund and deduction and transfer gated to Admin), and the monthly collection statement.
- **Phase 4 — Operational rollout** (done): reminder dashboard (renewal notices, upcoming rate changes, deposit shortfalls, overdue escalation past 10 days — computed live, not persisted, so a reminder disappears the moment its cause is resolved), simple per-contract late-penalty calculation, a generated PDF contract summary, and CSV exports.
- **Phase 5 — External notifications** (not started): WeChat/SMS urgent delivery, deferred per the brief until a provider is selected and validated.

### Charge generation engine

`server/src/billing/chargeEngine.ts` is pure and unit-tested (`server/src/billing/chargeEngine.test.ts`, run with `npx tsx --test src/billing/chargeEngine.test.ts` from `server/`) against the brief's §12 acceptance scenarios: two units at different per-sqm rates, a mid-month rate change with correct proration, percentage escalation compounding, and free rent on one fee component while another (e.g. management fee) stays payable. Charge generation is idempotent — repeating it for an already-billed period creates nothing new — and every charge carries a `calculation_snapshot` recording exactly which rate, area, and dates produced it.

Trigger it via `POST /api/contracts/:id/generate-charges` with `{ "period": "YYYY-MM" }`, or `GET /api/contracts/:id/charges` to list what's been posted.

### Amendments

A contract accepts direct edits (units, pricing, concessions, deposit terms) only while in `draft` status. `POST /api/contracts/:id/activate` requires a `signed_lease` document to already be uploaded and locks the contract to `active`; from then on, changes go through `POST /api/contracts/:id/amendments` → `POST /api/amendments/:id/submit` → `POST /api/amendments/:id/approve`. Submitting a non-Admin amendment leaves it `pending` for Admin review; an Admin's own submission auto-approves. Approval is rejected as stale if the contract's version has moved since the amendment was based, and everything in an approval (contract fields, new units, new rate rows, concessions, retroactive charge adjustments) commits in a single transaction alongside a new `contract_versions` snapshot.

### Receipts, allocations, and deposits

`server/src/billing/ledger.ts` is pure and unit-tested (`server/src/billing/ledger.test.ts`) against the brief's §12 scenarios: a partial receipt, one receipt spanning multiple months' charges, an overpayment left as visible unallocated credit rather than inflating a charge, a reversal that keeps both the original and the reversing row and restores balances correctly, and deposit refund/deduction reducing the held balance without touching the rent ledger. A `transfer_to_rent` deposit transaction creates a synthetic receipt internally so it goes through the same allocation/over-allocation guard as any other payment — the held amount and the amount applied to rent are conserved and never double-counted.

- `POST /api/contracts/:id/receipts`, `POST /api/receipts/:id/allocate`, `POST /api/receipt-allocations/:id/reverse`
- `POST /api/contracts/:id/deposit-transactions` (`transactionType`: `receipt` | `refund` | `deduction` | `transfer_to_rent`; refund/deduction/transfer require Admin), `POST /api/deposit-transactions/:id/reverse`
- `GET /api/contracts/:id/ledger` — charges with computed balance/overdue status, receipts with unallocated credit
- `GET /api/contracts/:id/statement?period=YYYY-MM` — the brief's first working milestone: opening receivable, new charges, adjustments, receipts applied, closing receivable, unallocated receipts, and deposit balance held separately

### Reminders, occupancy, and exports

- `GET /api/reminders` — computed live from current contract/charge/deposit state (`server/src/reports/reminders.ts`, unit-tested): renewal notice windows, rate changes due within 30 days, deposit shortfalls (skipped when an Admin has recorded the waiver condition as met), and overdue balances escalated past the brief's 10-day threshold. Nothing is persisted, so there's no "obsolete reminder" state to clean up — an amendment, payment, or adjustment that resolves the underlying condition makes the reminder disappear on the next request.
- Late penalty: `server/src/billing/latePenalty.ts` — a flat daily rate against the outstanding balance with an optional cap, configured per contract (`PATCH /api/contracts/:id/late-penalty-rules`, draft only) and surfaced as `latePenaltyFen` on `GET /api/contracts/:id/ledger`. Deliberately not a rule engine, per the brief.
- `GET /api/reports/occupancy?date=YYYY-MM-DD` — leased/total rentable area and unit counts, building and open-land reported separately so combining them never misstates either figure.
- `GET /api/contracts/:id/pdf-summary` — a generated PDF (terms, units, pricing, deposit, payment ledger, amendment history), gated the same way document download is (`canDownloadPdf` / Admin / Manager).
- `GET /api/contracts.csv` and `GET /api/contracts/:id/ledger.csv` — CSV exports respecting the same scope and `canPrint` gate.

See the project brief for the full phase plan and acceptance scenarios.
