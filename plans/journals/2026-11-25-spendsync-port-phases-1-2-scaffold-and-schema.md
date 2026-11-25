---
title: "SpendSync port phases 1-2: scaffold and schema"
date: 2026-11-25
summary: "Bun workspace, Elysia/Vite skeleton and Drizzle SQLite schema landed; review caught a migration data-loss trap and a fail-open NODE_ENV default."
---

# SpendSync port phases 1-2: scaffold and schema

## What happened

Phases 1 and 2 of `plans/261125-0632-spendsync-port-elysia-react` landed on `feat/spendsync-port`:

- A Bun workspace with an Elysia 1.4 API, a Vite 8 React SPA, a shared package and the inbound-worker manifest. TypeScript 7 works across the chain, so no fallback was needed.
- A Drizzle `bun:sqlite` schema with Better Auth tables in one initial migration, the 44 system categories, category scopes and inbound tokens.

An independent review then found real defects, and all of them were fixed:

- `migrateDatabase` ran migrations with `foreign_keys=ON`. drizzle-kit's table-rebuild migrations issue `PRAGMA foreign_keys=OFF` inside a transaction, where SQLite ignores it, so `DROP TABLE user` would cascade-delete every user's data. Migrations now turn foreign keys off around `migrate()`, run `foreign_key_check` afterwards, and have a regression test that replays a rebuild.
- `NODE_ENV` defaulted to `development`, and Bun does not set it. A production box would have used random secrets, leaked stack traces and rejected every inbound webhook. Unset now means production, `bun run dev` sets development, and production requires `APP_URL`.
- `throw status(...)` became a 500. Response-schema failures came back as 422. 404s were logged as 200.
- SQLite does not index foreign keys automatically. FK indexes, `amount >= 0` checks and SQL timestamp defaults were added while `0000` is still fresh-install-only.

Gotchas:

- A global `onError` return value widens every route's Eden success type. Return a `Response` instead.
- Drizzle `$count` is awaitable only.
- The Better Auth CLI is now the `auth` package and needs `bunx --bun` because the config imports `bun:sqlite`.

## Decision

- The `jobs` table moves to phase 4.
- The seeder also moves soft-deleted transactions when it merges user copies.

## Next steps

Phase 3 (parsing engine). The phase 4 and 5 files carry handover notes on synchronous transactions, the jobs migration, the dev origin and auth regeneration.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
