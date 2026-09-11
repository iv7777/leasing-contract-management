# Lease Contract Management

A web app for managing ~100 factory/property lease contracts across China, with an owner working remotely from the US.

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
npm run backup --workspace=server
```

Writes a consistent SQLite snapshot plus a manifest of every referenced document under `server/storage/backups/<timestamp>/`. Set `ENABLE_BACKUP_SCHEDULE=true` in `server/.env` to also run this daily at 02:15 Asia/Shanghai time via the running server process. An off-site copy outside China and a documented restore drill are required before production use per the project brief — neither is automated yet.

## Delivery phases

- **Phase 1 — Foundation** (done): authentication, roles (Admin/Manager/Collector/Viewer), property/unit inventory, tenant/landlord records (with Admin-only sensitive identity details), private classified document storage, append-only audit logging, backup/restore.
- **Phase 2 — Agreements and calculation** (done): contracts, contract units, pricing streams (per-unit, grouped, or contract-wide), rate schedules (flat / per-sqm / percentage escalation), free-rent and discount concessions, deposit terms, the charge-generation engine (`server/src/billing`), and the amendment workflow (draft → pending → approved, with staleness checks and a `contract_versions` snapshot on every approval).
- **Phase 3 onward** (not started): receipts, allocations, unallocated credit, adjustments/reversals, deposit movements, the monthly collection statement, reminders, and reporting.

### Charge generation engine

`server/src/billing/chargeEngine.ts` is pure and unit-tested (`server/src/billing/chargeEngine.test.ts`, run with `npx tsx --test src/billing/chargeEngine.test.ts` from `server/`) against the brief's §12 acceptance scenarios: two units at different per-sqm rates, a mid-month rate change with correct proration, percentage escalation compounding, and free rent on one fee component while another (e.g. management fee) stays payable. Charge generation is idempotent — repeating it for an already-billed period creates nothing new — and every charge carries a `calculation_snapshot` recording exactly which rate, area, and dates produced it.

Trigger it via `POST /api/contracts/:id/generate-charges` with `{ "period": "YYYY-MM" }`, or `GET /api/contracts/:id/charges` to list what's been posted.

### Amendments

A contract accepts direct edits (units, pricing, concessions, deposit terms) only while in `draft` status. `POST /api/contracts/:id/activate` requires a `signed_lease` document to already be uploaded and locks the contract to `active`; from then on, changes go through `POST /api/contracts/:id/amendments` → `POST /api/amendments/:id/submit` → `POST /api/amendments/:id/approve`. Submitting a non-Admin amendment leaves it `pending` for Admin review; an Admin's own submission auto-approves. Approval is rejected as stale if the contract's version has moved since the amendment was based, and everything in an approval (contract fields, new units, new rate rows, concessions, retroactive charge adjustments) commits in a single transaction alongside a new `contract_versions` snapshot.

See the project brief for the full phase plan and acceptance scenarios.
