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

**Permanent backups**: an Admin can mark any successful backup as permanent from the Backups page (pin icon, `PATCH /api/backups/:id/pin`). A permanent backup is never pruned, does not occupy one of the 30 slots of its kind, and does not count toward "the daily rotation is full" for the weekly trigger. Un-marking returns it to the rotation and, if it is older than the newest 30, deletes it immediately (the UI asks first). `restore-backup` keeps permanent flags too, and puts back the row of any permanent backup newer than the restored snapshot so it stays listed; restoring a snapshot from before this feature cannot carry them over and prints the folders instead. Permanent backups use disk until un-marked — the page shows their count and total size.

**Comments**: an Admin can attach a short note (up to 500 characters) to any backup run from the Backups page (`PATCH /api/backups/:id/comment`); it shows on a second line under the run. Because the note lives in the database, `restore-backup` carries the current comments over to the runs that still exist in the restored database.

Restoring: use `deploy/vps-deploy.sh`'s control-panel menu ("Restore the database from a backup", or `--restore-backup`) if you deployed with it — it scans `BACKUP_DIR`, validates each snapshot (SQLite header, and a `PRAGMA integrity_check` when `sqlite3` is available), and lets you pick one. Otherwise, on the server directly:

```bash
cd server && npm run restore-backup -- <backup ID | path-to-backup-dir>
```

Either way, the systemd service (if present) is stopped and restarted automatically around the restore, and a safety copy of the current database is saved first. Document files under `DOCUMENT_STORAGE_DIR` are never touched by a restore — recover those separately from `documents.manifest.json` in the backup folder if needed.

**Refreshing and verifying the backups**: if you delete backup folders by hand, use the control panel's "Refresh and verify the backups" (or `--refresh-backups`, or `cd server && npm run sync-backups`). It removes list entries whose folder no longer exists, then checks every remaining snapshot is a working copy — a valid SQLite file, a clean `integrity_check`, the expected tables and a readable document manifest. A snapshot that fails is marked **Failed** with the reason (so it can't be restored by mistake) and is re-checked on the next run; missing manifests or missing referenced document files are reported as warnings only. No backup file is changed, the server can keep running, and folders on disk that aren't listed are reported only.

**Opening the control panel**: once installed, run `sudo lcm` from anywhere (a link in `/usr/local/bin` to `deploy/vps-deploy.sh` in the app checkout, created automatically by the script; override the name with `COMMAND_NAME`). The menu header and `--status` show the installed app version, and "Check for updates" reports the version it updates to. Because the link points into the checkout, it always runs the script version that the last update pulled.

**Initializing the database (start fresh)**: `deploy/vps-deploy.sh` has a menu option "Initialize the database (start fresh)" (or `--initialize-db`, plus `--keep-contracts`), or on the server directly `cd server && npm run initialize-db [-- --keep-contracts]`. It asks which to clear:

- **Everything**: Tenants & Landlords, properties, units, contracts (with pricing, deposit terms, amendments, versions, documents), bills, payments, readings, deposit movements, billing-run history.
- **Keep contracts and Tenants & Landlords** (`--keep-contracts`): clears only what happened under them — bills, adjustments, payments and allocations, meter readings, deposit movements, the billing-run log and **all amendments** (with the contract version history) — sets every contract back to **draft** at version 1 and switches automatic billing off, restoring any document an amendment had withdrawn (terms an amendment already changed stay as they are), so each one is checked, activated again and brought up to date with Catch up billing and the payments entered anew.

In both modes the **audit log is wiped**, then one "initialized" entry is added to the fresh log; user accounts and sessions, app settings and the backup list are kept, and document files on disk are never deleted. The script stops the service, saves a safety copy to `BACKUP_DIR/pre-init-<time>` first (listed by, and restorable with, the restore option), requires a typed `INITIALIZE`, and restarts the service.

An off-site copy outside China and a documented restore drill are required before production use per the project brief — neither is automated yet. If you set one up with `rclone`, prefer `rclone copy` over `rclone sync`: since local retention now prunes on its own, a `sync` would mirror those deletions off-site too, defeating the point of a separate off-site archive.

## Delivery phases

- **Phase 1 — Foundation** (done): authentication, roles (Admin/Manager/Collector/Viewer), property/unit inventory, tenant/landlord records (with Admin-only sensitive identity details), private classified document storage, append-only audit logging, backup/restore.
- **Phase 2 — Agreements and calculation** (done): contracts, contract units, pricing streams (per-unit, grouped, or contract-wide), rate schedules (flat / per-sqm / percentage escalation), free-rent and discount concessions, deposit terms, the charge-generation engine (`server/src/billing`), and the amendment workflow (draft → pending → approved, with staleness checks and a `contract_versions` snapshot on every approval).
- **Phase 3 — Collection pilot** (done): receipts, allocations with over-allocation guards on both the receipt and the charge, unallocated credit, reversals (append-only — nothing is edited or deleted), a deposit ledger (receipt/refund/deduction/transfer-to-rent, refund and deduction and transfer gated to Admin), and the monthly collection statement.
- **Phase 4 — Operational rollout** (done): reminder dashboard (renewal notices, upcoming rate changes, deposit shortfalls, overdue balances from the first day after the grace period, missing meter readings — computed live, not persisted, so a reminder disappears the moment its cause is resolved), simple per-contract late-penalty calculation, a generated PDF contract summary, and CSV exports.
- **Phase 5 — External notifications** (not started): WeChat/SMS urgent delivery, deferred per the brief until a provider is selected and validated.

### Automatic billing

Charges are created automatically so staff see what is due the moment they log in. Per contract this is switched on by an Admin, never implicitly:

- **Nightly job** (`server/src/jobs/billing.ts`, 03:00 Asia/Shanghai, runs unless `ENABLE_CHARGE_GENERATION_SCHEDULE=false`): for every active, **monthly-billed** contract with `billing_rules.auto_billing` on, it posts every charge already due plus everything falling due by the end of the current month. Idempotent (charges already posted are skipped), isolates failures per contract, and logs each run in `billing_runs` (Admin → Billing runs, with a *Run billing now* button). Metered fees (electricity, water) are the one manual input: they are billed once a reading exists, due on the contract's due day in the month *after* the usage month.
- **Catch-up for leases that started before the system** (Admin, contract → Charges → *Catch up billing*): previews every charge from the first month of the lease through the end of this month, and only after confirmation posts them and turns `auto_billing` on. The server re-checks the reviewed totals so only what was previewed can be posted. Then enter the payments already collected (Receipts → *Bulk payments*) to bring the tenant's account current. Existing contracts stay off until this is done; leases activated before they start join automatically. Quarterly/yearly contracts are not auto-billed yet (the engine bills one calendar month at a time) and stay on manual generation.
- **Due dates and overdue**: when a lease is silent, rent is due on the 1st and a charge is overdue only after a 5-day grace period (`billing_rules.due_day` / `overdue_grace_days`, editable per contract; a lease's own due day and grace override the defaults). Days overdue count from the end of the grace period.
- **Payments**: *Record payment* applies money to the oldest unpaid charges first (editable split; any remainder stays unallocated credit); *Bulk payments* enters many past payments in date order, all or nothing. Meter readings can be entered one at a time or month-by-month in a grid.
- **Void** (Admin): the undo for a mistaken charge. The row stays, marked voided with a reason; refused while payments are applied. While auto-billing is on, a voided period is re-billed by the next run unless billing is paused or the terms are corrected first.
- **Overdue markers**: `GET /api/billing/overdue-summary` (same balance rules and visibility as the overview; `?contractId=` for one contract) feeds a red tag on the Contracts list (amount and age of the oldest overdue bill), a count tag on the Properties list, and a tag plus a dot on the contract page's Charges tab. Deposit shortfalls use an orange tag/dot so the two never look alike.
- **Not billed yet** is a forecast of dues through the end of next month. Contracts not yet on automatic billing are included too (only dues still ahead of today — their unbilled history is what Catch up billing is for), so the box isn't empty before every lease has been caught up.
- **Per-contract forecast**: the contract page has a *Not billed yet* tab (`GET /api/contracts/:id/billing/upcoming`) listing that contract's forecast dues through the end of next month, with total, any missing meter readings and a note when automatic billing is off. It shares `projectContract` in `server/src/routes/billing.ts` with the Dashboard, so the two always agree.
- **Dashboard**: each user sees overdue, due now, due later this month and not-yet-billed amounts for their assigned properties, plus missing meter readings (`GET /api/billing/overview`).

Note: this generates history from day one and relies on entered payments to reconcile, rather than the brief's opening-balance import at a cutover date. The catch-up preview and void exist as the guard rails for that choice.

### Form prefills

Forms open with what is almost always typed, always editable: a new unit takes the contract's start date and the unit's rentable area; a new pricing item takes the contract start, the contract's units and the fee's name, and choosing *Metered* sets the basis to per unit and the unit (度 / 立方米 in Chinese, kWh / m³ in English); a new rate row continues the previous one (start the day after it ends, same method, basis and unit); concessions start at the contract start at 100% with 1/2/3-month quick-picks; deposit terms offer 1/2/3 months' rent; a deposit receipt/refund fills the shortfall/held balance; *Allocate* fills the smaller of the credit and the bill; a new contract keeps the latest landlord and offers 1/3/5/6-year term quick-picks; *Record usage* opens on last month with the stream and unit filled in; the bulk-payments grid starts at the earliest due date and amount. (`web/src/pages/ContractDetailPage.tsx`, `ContractsPage.tsx`, `components/billing/*`.)

### Charge generation engine

`server/src/billing/chargeEngine.ts` is pure and unit-tested (`server/src/billing/chargeEngine.test.ts`, run with `npx tsx --test src/billing/chargeEngine.test.ts` from `server/`) against the brief's §12 acceptance scenarios: two units at different per-sqm rates, a mid-month rate change with correct proration, percentage escalation compounding, and free rent on one fee component while another (e.g. management fee) stays payable. Charge generation is idempotent — repeating it for an already-billed period creates nothing new — and every charge carries a `calculation_snapshot` recording exactly which rate, area, and dates produced it.

Trigger one month by hand via `POST /api/contracts/:id/generate-charges` with `{ "period": "YYYY-MM" }` (the nightly job does this automatically for contracts on automatic billing — see above), or `GET /api/contracts/:id/charges` to list what's been posted.

### Amendments

A contract accepts direct edits (units, pricing, concessions, deposit terms) only while in `draft` status. `POST /api/contracts/:id/activate` requires a `signed_lease` document to already be uploaded and locks the contract to `active`; from then on, changes go through `POST /api/contracts/:id/amendments` → `POST /api/amendments/:id/submit` → `POST /api/amendments/:id/approve`. Submitting a non-Admin amendment leaves it `pending` for Admin review; an Admin's own submission auto-approves. Approval is rejected as stale if the contract's version has moved since the amendment was based, and everything in an approval (contract fields, new units, new rate rows, concessions, retroactive charge adjustments) commits in a single transaction alongside a new `contract_versions` snapshot.

### Receipts, allocations, and deposits

`server/src/billing/ledger.ts` is pure and unit-tested (`server/src/billing/ledger.test.ts`) against the brief's §12 scenarios: a partial receipt, one receipt spanning multiple months' charges, an overpayment left as visible unallocated credit rather than inflating a charge, a reversal that keeps both the original and the reversing row and restores balances correctly, and deposit refund/deduction reducing the held balance without touching the rent ledger. A `transfer_to_rent` deposit transaction creates a synthetic receipt internally so it goes through the same allocation/over-allocation guard as any other payment — the held amount and the amount applied to rent are conserved and never double-counted.

- `POST /api/contracts/:id/receipts`, `POST /api/receipts/:id/allocate`, `POST /api/receipt-allocations/:id/reverse`
- `POST /api/contracts/:id/deposit-transactions` (`transactionType`: `receipt` | `refund` | `deduction` | `transfer_to_rent`; refund/deduction/transfer require Admin), `POST /api/deposit-transactions/:id/reverse`
- `GET /api/contracts/:id/ledger` — charges with computed balance/overdue status, receipts with unallocated credit
- `GET /api/contracts/:id/statement?period=YYYY-MM` — the brief's first working milestone: opening receivable, new charges, adjustments, receipts applied, closing receivable, unallocated receipts, and deposit balance held separately

### Reminders, occupancy, and exports

- `GET /api/reminders` — computed live from current contract/charge/deposit state (`server/src/reports/reminders.ts`, unit-tested): renewal notice windows, rate changes due within 30 days, deposit shortfalls and manual-check deposits (from the shared `computeDepositStatus` in `server/src/billing/depositStatus.ts`, so the contract page, dashboard and reminders always agree), one overdue-balance reminder per contract from the first day after the grace period (critical at 30+ days), and missing meter readings. Nothing is persisted, so there's no "obsolete reminder" state to clean up — an amendment, payment, or adjustment that resolves the underlying condition makes the reminder disappear on the next request.
- Late penalty: `server/src/billing/latePenalty.ts` — a flat daily rate against the outstanding balance with an optional cap, configured per contract (`PATCH /api/contracts/:id/late-penalty-rules`, draft only) and surfaced as `latePenaltyFen` on `GET /api/contracts/:id/ledger`. Deliberately not a rule engine, per the brief.
- `GET /api/reports/occupancy?date=YYYY-MM-DD` — leased/total rentable area and unit counts, building and open-land reported separately so combining them never misstates either figure.
- `GET /api/contracts/:id/pdf-summary` — a generated PDF (terms, units, pricing, deposit, payment ledger, amendment history), gated the same way document download is (`canDownloadPdf` / Admin / Manager).
- `GET /api/contracts.csv` and `GET /api/contracts/:id/ledger.csv` — CSV exports respecting the same scope and `canPrint` gate.

See the project brief for the full phase plan and acceptance scenarios.

### Handbook (in-app guide)

The **Guide** page is a bilingual (English / 中文) handbook for beginners covering the whole contract lifecycle: role quick-start, concepts, preparing data, creating and activating a contract, billing and catch-up, collecting payments, deposits, amendments, renewal and termination, routines, a worked example, an FAQ and a label reference. Its content is plain typed data in `web/src/guide/content.en.ts` and `content.zh.ts` (rendered by `web/src/pages/GuidePage.tsx`), so a chapter can be edited without touching layout code; keep the two files in step. The help drawer's *Read the full guide* link opens the chapter matching the current page (`web/src/help/registry.ts`).
