---
phase: 6
title: "Domain API"
status: pending
priority: P1
effort: "10h"
dependencies: [3, 4, 5]
---

# Phase 6: Domain API

## Goal

Expose every server-side behavior of the Livewire components as typed Elysia endpoints (the Gmail connect, sync and disconnect actions are replaced by forwarding setup, address rotation and history imports), with tenant isolation and demo read-only enforcement proven by tests, and seed the demo account.

## Source references

- `app/Livewire/Transactions/{Index,Show,Form}.php`, `app/Livewire/Reports.php`, `app/Livewire/Settings.php`, `app/Livewire/Concerns/*` (`ConnectGmail.php` is not ported; see the [advise report](../reports/advise-261125-1347-gmail-forwarding-ingest.md))
- `app/Policies/*`, `app/Support/{Demo,Format}.php`, `app/Providers/AppServiceProvider.php` (global write guard), `routes/web.php` (demo start/stop)
- `database/seeders/{DemoSeeder,DemoLedger}.php`
- `tests/Feature/{UiTest,DemoTest,DataModelTest}.php` (behavioral oracle)

## Cross-cutting design

- `apps/server/src/domain/owner.ts`: `resolveOwner(user)` returns the demo user when `user.viewingDemo` and the demo account exists, else the user (upstream `Demo::owner()`). Reads use the owner; writes go through domain functions that take `{ actor, ownerId }`.
- `apps/server/src/domain/demo.ts`: `demoUserId()` (cached per request), `assertWritable(ctx, rowUserId)` throws `DemoReadOnlyError` when a signed-in actor writes a demo-owned row. Background jobs and CLI pass `ctx = system` and skip the check, as upstream does for unauthenticated contexts. The HTTP error handler maps it to `403 { error: { code: 'demo_read_only' } }`.
- `requireOwned(table, id, ownerId)` returns 404 for rows the owner cannot reach (never 403, to avoid leaking existence).
- Month bounds: `?month=YYYY-MM` interpreted in `APP_TIMEZONE`, invalid or missing = current month; queries use UTC `[start, end)`.

## Endpoints (all under `/api`, auth required unless noted)

| Method + path | Behavior (from source) |
| --- | --- |
| `GET /transactions?month&filter&category&payee` | Month totals (spent, income) excluding hidden **and unverified** rows; list including hidden and unverified (each row carries `hidden` and `unverified` flags), filtered `all|uncategorized|in|out`, category scope includes children, payee exact match; ordered by occurred_at desc, id desc; grouped by local day; `latestMonth` when the month is empty; `hasAnyTransactions`; `unverifiedCount` for the month; forwarding summary (has an address, has received any bank email); unknown category → 404 code `category_not_found` so the client drops the param |
| `GET /transactions/:id` | Detail (including hidden), category, bank name or "manual", `verification` (`dkim_pass`, `unverified`, `user_confirmed`, `user_upload`, or null for manual) with `dkimDomain`, `ruleTarget` text parts, `followsRule`, `backfillCount`, `rawEmail` meta, fitting categories ordered |
| `POST /transactions/:id/confirm` | Only for unverified rows: clear `transactions.unverified`, set `raw_emails.verification = user_confirmed` |
| `GET /transactions/:id/raw` | Normalized plain text of the raw email (owner only; client renders as escaped text) |
| `PUT /transactions/:id/category` | Category must fit the direction; returns updated `followsRule` |
| `PUT /transactions/:id/rule` `{ enabled }` | Remember or forget the rule for this transaction (account → name → description) |
| `POST /transactions/:id/backfill` | Apply the draft rule to uncategorized matches; returns count |
| `PUT /transactions/:id/note` | ≤1000 chars, trimmed, empty → null |
| `POST /transactions/:id/toggle-hidden` | Soft delete / restore |
| `DELETE /transactions/:id` | Manual transactions only (else 404); force delete; returns month for redirect |
| `POST /transactions`, `PUT /transactions/:id` | Manual add/edit: amount string `^[1-9]\d{0,2}(\.?\d{3})*$`, occurredAt `YYYY-MM-DDTHH:mm` local, counterparty required ≤255, category must fit direction, note ≤1000; edit only manual rows; new uncategorized rows run the matcher |
| `GET /categories?direction` | Available categories that fit, ordered |
| `GET /reports?month` | Spending by top-level category (children rolled into parent), total, change % vs previous month (same elapsed stretch when the month is current), top 5 counterparties; unverified and hidden rows excluded everywhere |
| `GET /settings/summary` | Category count, rule count, forwarding summary |
| `GET/POST/PATCH/DELETE /settings/categories…` | List by type with transaction counts and parent/child order; add (name ≤50, icon ≤16, type expense or income only, optional top-level parent of the same type, order 1); rename/re-icon own; delete own |
| `GET/DELETE /settings/rules…` | List own rules newest first with category; delete own |
| `GET /forwarding` | Active address (`<token>@INBOUND_DOMAIN`, created on first call if missing), latest Gmail confirmation received in the last 24 h (`gmailAddress`, `code`, `confirmUrl`, `receivedAt`), last received email per supported bank, sender list for the filter, unverified count. Polled by the connect screen |
| `POST /forwarding/rotate` | Mark the current address replaced, create a new one; 5 per day per user (`too_many_attempts`). Old address stops receiving immediately |
| `GET /forwarding/filter.xml` | Gmail filter export file (Atom with `apps:property` entries: `from` = `sender1 OR sender2 …`, `forwardTo` = the active address, `shouldNeverSpam` true, `label` = "Bank Sync"); `Content-Disposition: attachment` |
| `POST /imports` | Multipart upload of `.eml` files or one `.mbox` (≤ `UPLOAD_MAX_BYTES`), processed by `import-upload` from phase 4 for the owner; 10 per hour per user; returns `{ imported, duplicates, skipped }`. Error codes `file_too_large`, `unsupported_file`, `too_many_attempts` |
| `POST /demo`, `DELETE /demo` | Set / clear `viewingDemo` |
| `GET /public/config` (no auth) | App name, source URL, analytics flag, supported banks |

`POST /api/inbound/email` (phase 4) is the only unauthenticated write route; it is authenticated by HMAC and never touches session or demo state. Never return `body_html` or `body_text` from any endpoint; the raw email is exposed only as normalized text through `/transactions/:id/raw`.

## Demo seed

- `apps/server/src/db/seed/demo.ts` + `demo-ledger.ts`: port `DemoSeeder` and `DemoLedger` (seeded Mt19937-compatible generator so the ledger is the same every run). Create the user through Better Auth's server API (password `password` when `NODE_ENV=development`, random otherwise), add the 11 rules, run `import-eml` on the fixtures, hide and annotate the 3 listed counterparties, add the ledger, run `refresh-demo`.

## Files to Create

- `apps/server/src/routes/{transactions,categories,reports,settings-categories,settings-rules,forwarding,imports,demo,public}.ts`
- `apps/server/src/domain/gmail-filter-xml.ts`
- `apps/server/src/domain/{owner,demo,transactions,reports,settings}.ts`
- `apps/server/src/db/seed/{demo,demo-ledger}.ts`
- `apps/server/test/api/*.test.ts`

## Verification

- `bun test apps/server/test/api` passes, including:
  - Isolation: user B gets 404 for user A's transaction, category, rule, raw email on every route, and `/forwarding` never shows another user's address or confirmation.
  - Demo: while viewing demo, every mutating route above (including confirm, rotate and imports) returns `403 demo_read_only`; signing in directly as the demo user is also read-only; background jobs can still write demo rows.
  - Unverified: an unverified transaction appears in the list with its flag but not in month totals or reports; after confirm it counts.
  - Forwarding: first `GET /forwarding` creates exactly one address; rotate replaces it and the old token gets 404 at the inbound route; a confirmation older than 24 h is not returned; `filter.xml` contains every configured sender and the active address.
  - Imports: rate limit and size limit; result counts.
  - Ports of the behavioral cases in `UiTest.php`, `DemoTest.php`, `DataModelTest.php` that concern server logic (filters, totals exclude hidden, reports roll-up and comparison, rules priority, backfill counts, manual add/edit/delete rules). Upstream connect and sync cases are dropped with IMAP and listed in `docs/testing.md`.
  - A response-shape test asserting no endpoint payload contains `body_html` or `body_text`.

## Risks

- Missing a write path in the demo guard. Mitigation: the demo test iterates over a list of all mutating routes, and a lint-style test fails if a route file defines a non-GET handler that is not in that list.
