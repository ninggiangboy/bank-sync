---
title: "Port SpendSync to Elysia + Vite React (Bank Sync)"
description: "Rebuild the SpendSync Laravel/Livewire app at feature parity as Bank Sync on Bun, Elysia 1.4, Drizzle + SQLite and a React 19 SPA built with Vite 8."
status: in-progress
priority: P1
effort: 78h
tags: [feature, backend, frontend, database, auth, port]
blockedBy: []
blocks: []
created: 2026-11-25
---

# Port SpendSync to Elysia + Vite React (Bank Sync)

## Overview

Rebuild https://github.com/henrybuidotdev/spendsync (commit `ba44f1f`, AGPL-3.0) in this empty directory as **Bank Sync**: Bun 1.4 + Elysia 1.4.32 API, Drizzle 0.45 on `bun:sqlite`, Better Auth 1.7, an SQLite job table with an in-process worker and cron, email ingest through Cloudflare Email Routing + an Email Worker with DKIM verification (mailauth) and mailparser, and a React 19.3 SPA (Vite 8.3, TanStack Router + Query, Tailwind 4.3, react-i18next) typed against the API with Eden Treaty. Behavior, data rules and UX follow the source, except how bank emails reach the app; the stack is idiomatic for the target.

Analysis (source anatomy, dependency matrix, decision matrix, risk score): [xia port analysis](../reports/xia-261125-1328-spendsync-port-analysis.md). Connection decision: [forwarding instead of IMAP](../reports/advise-261125-1347-gmail-forwarding-ingest.md).

## Accepted decisions

- Queue: SQLite job table + in-process worker; Horizon/Redis dropped. Database: SQLite. Name: **Bank Sync**. (user, 2026-11-25)
- **No Gmail app password or IMAP.** Users forward bank emails with a Gmail filter to a per-user address received by Cloudflare Email Routing; history comes from `.eml` / `.mbox` uploads; mail without a valid bank DKIM signature becomes an unverified transaction that is excluded from totals until the user confirms it. (user, 2026-11-25)
- License stays **AGPL-3.0-only** with upstream credit and a visible "source code" link (`APP_SOURCE_URL`).
- Fresh install only: no import from a Laravel deployment. One initial migration with the final schema.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Workspace scaffold](./phase-01-workspace-scaffold.md) | Done |
| 2 | [Database schema and seed](./phase-02-database-schema.md) | Pending |
| 3 | [Parsing engine with fixture parity](./phase-03-parsing-engine.md) | Pending |
| 4 | [Email ingest, DKIM, job queue, scheduler, CLI](./phase-04-mail-sync-queue.md) | Pending |
| 5 | [Auth, profile and user settings](./phase-05-auth-settings.md) | Pending |
| 6 | [Domain API](./phase-06-domain-api.md) | Pending |
| 7 | [Frontend shell](./phase-07-frontend-shell.md) | Pending |
| 8 | [Frontend pages](./phase-08-frontend-pages.md) | Pending |
| 9 | [PWA, production build and docs](./phase-09-pwa-production-docs.md) | Pending |
| 10 | [Test parity and CI](./phase-10-test-parity-ci.md) | Pending |

Order: 1 → 2 → 3 → 4; 5 needs 2; 6 needs 3, 4, 5; 7 needs 1 (can run beside 2–6); 8 needs 6 and 7; 9 needs 8; 10 closes gaps across all phases (each phase already ships its own tests).

## Success criteria

- [ ] All 28 upstream `.eml` fixtures parse to their `expected.json` exactly (`bun test parsing`).
- [ ] Every user-visible flow of the source works, with forwarding in place of the Gmail connection: register/verify/login/reset, forwarding setup (personal address, Gmail confirmation code shown, filter instructions and `.xml`, last received per bank, address rotation), history upload (`.eml`/`.mbox`), list/filter/scope transactions by month, detail with category/rules/backfill/note/hide/delete/confirm-unverified, manual add/edit, reports, settings (forwarding, categories, rules, appearance), profile, delete data/account, demo viewing, vi/en, light/dark, PWA install.
- [ ] A real bank email forwarded from Gmail becomes a transaction in under 60 seconds; a forged email without a valid bank DKIM signature is unverified and counts in no total.
- [ ] Inbound requests with a bad HMAC or a timestamp more than 5 minutes off get 401; the same email forwarded and uploaded creates one transaction.
- [ ] Isolation tests prove a user cannot read or change another user's data; demo tests prove every mutating endpoint refuses demo-owned rows.
- [ ] The app stores no Google credentials: `grep -ri "imap\|app_password" apps/` finds nothing, and the Worker stores and logs no message content.
- [ ] `bun run typecheck`, `bun run lint`, `bun test`, Playwright e2e and `bun run build` pass; `bun run start` serves API + SPA from one process.
- [ ] README documents setup, env, CLI, architecture, adding a bank parser, license and upstream credit.

## Rollback

The target directory is empty and becomes a new git repository in phase 1. Each phase lands as its own commits; rolling back a phase means reverting its commits. The only external system is the Cloudflare Email Routing rule and Worker (phase 9); disabling the routing rule stops all inbound mail without touching stored data, and users can remove their Gmail filter at any time.
