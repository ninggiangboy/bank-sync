# Code Review: Phase 6 Domain API (uncommitted)

## Scope
- Files: `apps/server/src/app.ts`, `src/routes/{transactions,reports,settings-domain,forwarding,imports,demo,public}.ts`, `src/domain/{demo,transactions,reports,settings,forwarding,time,gmail-filter-xml}.ts`, `src/db/seed/{demo,demo-ledger,mt19937,index}.ts`, `test/api/*`
- LOC: about 2,900 new (src about 1,950, tests about 1,080)
- Focus: tenant isolation, demo write guard, unverified/hidden exclusion, upstream parity, imports
- Checks run: `bun test apps/server/test/api` passes 54/54; `tsc` clean; `biome check apps/server` clean. Scratch probes (kept outside the repo) confirmed each finding below.

## Overall Assessment
Tenant isolation and the guard on mutating routes are solid. Every id route goes through `requireTransaction(ownerId)`, and every category, rule or settings write is scoped to the owner. `writeContext` runs before rate limits and validation. `counted()` is applied to the list totals, the report and the previous-month comparison. No endpoint returns `body_html` or `body_text`. The Mt19937 port and the ledger's draw order match PHP. I found one real gap in the demo guard: two GET routes write data. The other findings are smaller parity or contract defects.

## Critical Issues
None.

## High Priority

### H1. GET routes write an inbound address for the demo account, so the demo account is not read-only
- `apps/server/src/routes/forwarding.ts:24` and `:37` call `forwardingState` and `filterXml`. In `apps/server/src/domain/forwarding.ts:19,76` these call `getOrCreateActiveAddress`, which inserts a row.
- Failing scenario: sign in as `DEMO_USER_EMAIL` (password `password` in development) and call `GET /api/forwarding`. The response is 200 with `<token>@INBOUND_DOMAIN`, and an `inbound_addresses` row is created for the demo user (probe: 0 rows before, 1 after). `GET /api/forwarding/filter.xml` does the same.
- Impact: this breaks the phase rule that signing in directly as the demo user is also read-only. Upstream refuses the same write: saving a `MailAccount` owned by the demo user goes through `Demo::ensureWritable` and throws. The address is also a live ingest path into the shared demo ledger. Anything forwarded to it is stored as demo data, and every demo viewer sees it, at least flagged as unverified. The mutating-route test cannot catch this because it only lists non-GET routes.
- Fix: refuse before creating anything. For example, in both handlers, when `user.id === demoUserId(db)`, throw `DemoReadOnlyError`, or return `address: null` without inserting. Add the demo actor to a test for GET `/forwarding` and `/forwarding/filter.xml`.

## Medium Priority

### M1. Oversized imports get a bare 413 from Bun, never the `file_too_large` JSON error
- `apps/server/src/index.ts:22` sets `maxRequestBodySize: UPLOAD_MAX_BYTES + 1 MiB`, which is the same threshold as the handler check in `apps/server/src/routes/imports.ts:32-35` (`UPLOAD_MAX_BYTES + FRAMING_BYTES`).
- Failing scenario: in production, upload 60 MB with the default 50 MB limit. Bun rejects the request before the handler runs and answers `413` with an empty body and no content type (probe: `413 null ""`). The handler's `file_too_large` branch can never run in production. The JSON code is only reachable when the body falls between `UPLOAD_MAX_BYTES` and `+1 MiB`, through `importUpload`'s size sum. The test passes only because `app.handle` bypasses `Bun.serve`.
- Fix: set the server limit a little above the handler threshold (for example `+ 2 MiB`), so the handler answers with the documented code. Otherwise the client has to treat a bare 413 as `file_too_large`.

## Low Priority

### L1. The report's change % rounds negative halves differently from upstream
- `apps/server/src/domain/reports.ts:101` uses `Math.round`. PHP `round()` rounds halves away from zero.
- Failing input: previous month spent 200.000, selected month spent 175.000. Change is -12.5%. Ours returns `-12` (probe), upstream returns `-13`.
- Fix: `const pct = (100 * (total - prev)) / prev; Math.sign(pct) * Math.round(Math.abs(pct))`.

### L2. Manual amounts lose precision beyond 2^53
- `apps/server/src/routes/transactions.ts:49-52` allows up to 20 characters. `apps/server/src/domain/transactions.ts:463` converts with `Number(...)`.
- Failing input: `amount: "12345678901234567890"` returns 200 and stores `12345678901234567000`. `"9007199254740993"` stores `...992`. Upstream's int64 cast is exact up to 9.2e18. Every total and report that includes such a row is wrong.
- Fix: reject when `!Number.isSafeInteger(value)`, for example with a 422 `amount` field error, or cap the digit count.

### L3. `refreshDemo` matches the demo email case-sensitively, but the seed lowercases it
- `apps/server/src/jobs/refresh-demo.ts:28` uses `eq(user.email, env.DEMO_USER_EMAIL)` as configured. `seedDemo` (`apps/server/src/db/seed/demo.ts:49`) and `demoUserId` both lowercase it.
- Failing scenario: `DEMO_USER_EMAIL=Demo@Example.com`. The seed creates `demo@example.com`, then both `refreshDemo(db)` (`demo.ts:117`) and the daily job find no user. The ledger is never moved to today, and the demo shows old months.
- Fix: lowercase inside `refreshDemo`, or normalize once in the `env` schema.

## Informational (verified, not blocking)
- **PUT /api/settings and the demo account (phase 5 route, outside this diff).** The demo test's `EXEMPT` list covers `PUT /api/settings` (`test/api/isolation-demo.test.ts:127`), so the demo account can write its own `user_settings`. `POST /api/demo` by the demo account also writes its own `viewing_demo`. Upstream's global guard refuses both. The impact is cosmetic, but it means "demo account is read-only" is not fully true.
- **Signing up with the demo email (same as upstream).** If the demo account was never seeded, anyone can sign up as `demo@example.com` (verification is not required) and become the account every demo viewer sees. Combined with H1, they can feed content into it. Consider refusing sign-up for `DEMO_USER_EMAIL`.
- **Ledger end date vs upstream.** `seedDemo` takes the newest transaction including hidden ones (`demo.ts:92-97`). Upstream excludes soft-deleted rows. With the current fixtures, the newest row is not hidden (`TRAN THI BICH` 2026-11-18), so the output is identical. The difference stays latent unless the fixtures change.
- **Missing `docs/testing.md`.** The phase verification requires the dropped upstream connect/sync cases to be listed in `docs/testing.md`. There is no `docs/` directory.
- **Phase file layout.** The phase file names `domain/owner.ts` and separate category/rules route files. They were merged into `domain/demo.ts`, `routes/transactions.ts` and `routes/settings-domain.ts`. The behavior is all present.

## Verified non-issues (evidence)
- **Isolation.** Every `:id` route uses `requireTransaction(id, ownerId)` and returns 404 for rows the user cannot reach. Category use goes through `availableTo(ownerId)` and `fitting`. Category edit/delete is own-only (`ownCategory`). Rule delete is filtered by `userId`. The scope's child category ids are also filtered by `availableTo`. The matcher's `remember/forget/backfill` are keyed on `row.userId`. Forwarding uses `user.id` only. The raw text lookup goes through the owned transaction.
- **Guard order.** `writeContext` comes first in every non-GET handler, before the rotate and import rate limits and before zod validation. The test enumerates `app.routes`, so a new non-GET route fails it unless exempted.
- **Unverified and hidden rows.** List totals, the report, top counterparties and the previous-month total all apply `counted()`. Backfill excludes hidden rows and includes unverified ones. That only fills in a category and does not affect totals, which matches upstream (no unverified concept there).
- **Month bounds.** `monthRange` uses `zonedInstant` with `[start, end)`. An invalid or missing `month` means the current local month. The same-period end (previous start plus elapsed ms, capped at month start) matches Carbon's `add(diff)` for Asia/Ho_Chi_Minh. In DST zones it can differ by up to 1 h.
- **Mt19937.** Seed 5489 gives 3499211612 as the first output (the reference value). Seeding, reload and tempering match `engine_mt19937.c`. `getInt` matches `php_random_range32`: the power-of-two mask, `limit = UINT32_MAX - UINT32_MAX % umax - 1`, and re-drawing on rejection.
- **DemoLedger.** The draw order matches PHP's left-to-right argument evaluation, including the `pick` and `setTime` ordering and the `&&` and `elseif` short-circuits that skip draws on weekends. Monthly items, final-month skips, one-offs and the `<= until` cutoff match.
- **Imports.** Rate limiting is counted before work. The total size and the extension/mbox-count checks give `unsupported_file` or `file_too_large`. The body is bounded by the server limit (see M1 for the error code).

## Recommended Actions
1. Fix H1: refuse or skip creating an address for the demo actor on `GET /forwarding` and `/forwarding/filter.xml`, and add a test.
2. Fix M1: raise `maxRequestBodySize` above the handler threshold so `file_too_large` is returned as JSON.
3. Fix L1 rounding, the L2 safe-integer check and L3 email casing. Each is a one-line change.
4. Decide on the phase 5 `PUT /settings` exemption and demo-email sign-up, and add `docs/testing.md`, or defer it to phase 10 explicitly.

## Metrics
- Tests: 54 pass / 0 fail (`test/api`)
- Type errors: 0. Lint: 0 (biome)

## Unresolved Questions
- Should a non-demo user who is viewing demo still be able to edit their own categories and rules, and rotate their address? Upstream allows writes to the viewer's own rows. The phase file asks for 403 on all mutating routes, and the current behavior follows the phase file.
