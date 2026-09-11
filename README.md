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

This repository currently implements **Phase 1 — Foundation**: authentication, roles (Admin/Manager/Collector/Viewer), property/unit inventory, tenant/landlord records (with Admin-only sensitive identity details), private classified document storage, append-only audit logging, and backup/restore. Contracts, billing, receipts, deposits, amendments, and reminders are Phase 2 onward.

See the project brief for the full phase plan and acceptance scenarios.
