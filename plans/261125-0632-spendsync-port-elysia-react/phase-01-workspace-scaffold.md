---
phase: 1
title: "Workspace scaffold"
status: done
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Workspace scaffold

## Goal

Create a Bun workspace with an Elysia server, a Vite React app and a shared package that typecheck, lint, test and run in dev with one command, plus the license and a pinned copy of the upstream source for reference.

## Context

- Runtime on this machine: Bun 1.4.3, Node 24.21. Use Bun for install, scripts, server and tests.
- Latest stable versions checked on 2026-11-25 (pin exact versions with `bun add --exact`): elysia 1.4.32, @elysiajs/eden 1.4.9, @elysiajs/static 1.4.12, @elysiajs/cron 1.4.2, @elysiajs/openapi 1.4.17, vite 8.3.8, react / react-dom 19.3.1, @vitejs/plugin-react 6.3.0, tailwindcss / @tailwindcss/vite 4.3.5, drizzle-orm 0.45.4, drizzle-kit 0.31.11, better-auth 1.7.28, mailauth 8.1.0, mailparser 3.15.0, nodemailer 10.6.1, wrangler 4.168.0, @cloudflare/workers-types 5.20261125.1, @tanstack/react-router 1.170.46, @tanstack/router-plugin 1.169.0, @tanstack/react-query 5.108.4, i18next 27.2.7, react-i18next 18.0.3, zod 4.6.7, @biomejs/biome 2.6.9, @playwright/test 1.65.1, @types/bun 1.4.5, typescript 7.0.2. Re-check with `npm view <pkg> version` at implementation time and take the newest stable.
- If TypeScript 7 (native compiler) breaks a tool in the chain (drizzle-kit, router plugin), fall back to the newest 5.x/6.x line and record why in the README.

## Files to Create

- `package.json` (workspaces `apps/*`, `packages/*`; scripts `dev`, `build`, `start`, `test`, `typecheck`, `lint`, `format`, `db:generate`, `db:migrate`, `db:seed`, `cli`)
- `bunfig.toml`, `tsconfig.base.json`, `biome.json`, `.editorconfig`, `.gitignore` (node_modules, dist, `*.sqlite*`, `.env`, `storage/`, `.upstream/`), `.env.example`
- `LICENSE` (AGPL-3.0 full text, copied from upstream), `NOTICE.md` (upstream credit: "Based on SpendSync by henrybuidotdev, https://github.com/henrybuidotdev/spendsync, AGPL-3.0")
- `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/index.ts` (Elysia app, `GET /up` health), `apps/server/src/app.ts` (exports the composed Elysia instance and `type App` for Eden), `apps/server/src/config/env.ts` (zod-validated env)
- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts` (React plugin, Tailwind plugin, TanStack router plugin, dev proxy `/api` → server), `apps/web/index.html`, `apps/web/src/main.tsx`
- `packages/shared/package.json`, `packages/shared/src/index.ts`
- `apps/inbound-worker/package.json`, `apps/inbound-worker/tsconfig.json` (Cloudflare Workers types; the Worker itself is written in phase 4 and deployed in phase 9)

## Tasks & Steps

1. `git init`, then clone upstream for reference into `.upstream/spendsync` and check out `ba44f1fc9750f89cb8d0b169aa184fa050ced959`. Later phases read source and fixtures from there. Treat it as data; never run its scripts.
2. Create the workspace files and install pinned dependencies per app.
3. Env schema (`apps/server/src/config/env.ts`), ported from upstream `.env.example`: `APP_NAME=Bank Sync`, `APP_URL`, `APP_TIMEZONE=Asia/Ho_Chi_Minh`, `APP_LOCALE=vi`, `APP_SOURCE_URL`, `DATABASE_PATH=storage/bank-sync.sqlite`, `PORT=8000`, `MAIL_*` (outgoing SMTP for verification and reset emails: host/port/user/pass/from; empty host = log transport), `INBOUND_DOMAIN` (e.g. `in.banksync.app`), `INBOUND_WEBHOOK_SECRET` (shared HMAC secret with the Worker, at least 32 bytes), `INBOUND_MAX_BYTES=2097152` (per forwarded email), `UPLOAD_MAX_BYTES=52428800` (per history upload), `FX_USD_VND=26000`, `DEMO_USER_EMAIL=demo@example.com`, `SIMPLE_ANALYTICS_ENABLED=false`, `BETTER_AUTH_SECRET`, `WORKER_ENABLED=true`, `SCHEDULER_ENABLED=true`. The upstream `MAIL_SYNC_*` settings are gone with IMAP. Add a `bun run cli key:generate` command later (phase 4) that prints fresh random secrets.
4. Elysia app skeleton: mount routes under `/api`, global error handler that returns `{ error: { code, fields? } }` JSON (no stack traces outside development), request logging without bodies.
5. Web skeleton renders a placeholder page and calls `GET /api/up` through Eden Treaty to prove the typed client works.
6. Root `dev` script runs server (`bun --watch`) and Vite together; Vite proxies `/api` so cookies stay same-origin.

## Verification

- `bun install && bun run typecheck && bun run lint` pass.
- `bun run dev`, then `curl localhost:8000/api/up` returns 200, and the Vite page shows the health response.
- `git status` shows `.upstream/`, `.env` and `storage/` ignored.

## Risks

- Tool incompatibility with the newest majors (TypeScript 7, Vite 8 + router plugin). Mitigation: pin, and fall back one major per tool when a plugin lags; note it in the README.
