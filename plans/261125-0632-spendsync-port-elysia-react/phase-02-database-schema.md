---
phase: 2
title: "Database schema and seed"
status: done
priority: P1
effort: "4h"
dependencies: [1]
---

# Phase 2: Database schema and seed

## Goal

Define the schema in Drizzle on `bun:sqlite`: the upstream end state for the domain tables, with the IMAP mail account replaced by forwarding addresses, and seed the shared system categories.

## Source references

- Final schema = end state of `.upstream/spendsync/database/migrations/*` (read all 24; summary below).
- `database/seeders/SystemCategorySeeder.php` (44 categories, parents, order, merge of user copies).
- `app/Models/*.php` (casts, scopes `availableTo`, `ordered`, `fitting`, `fits`, debt/loan directions, `color = id % 8 + 1`).
- Forwarding decision: [advise report](../reports/advise-261125-1347-gmail-forwarding-ingest.md).

## Schema

Better Auth owns `user`, `session`, `account` and `verification`; generate them in this phase (Better Auth CLI `generate` for the Drizzle SQLite adapter, additional user field `viewingDemo` boolean default false). Every `user_id` below is a text FK to `user.id` with cascade, and everything lands in one initial migration.

| Table | Columns | Constraints |
| --- | --- | --- |
| `user_settings` | id, user_id, locale `vi|en` default `vi`, theme `light|dark|system` default `system`, timestamps | unique user_id |
| `inbound_addresses` (replaces `mail_accounts`) | id, user_id, token (26-char lowercase base32, ≥128 bits random), created_at, replaced_at nullable | unique token; at most one row per user with `replaced_at IS NULL` (partial unique index) |
| `forwarding_confirmations` | id, user_id, inbound_address_id, gmail_address (parsed from the confirmation email), code, confirm_url, received_at | index (user_id, received_at). Only the last 5 per user are kept |
| `raw_emails` | id, user_id, inbound_address_id (nullable, set null), source `forward|upload`, verification `dkim_pass|unverified|user_confirmed|user_upload`, dkim_domain nullable, message_id, from_address, subject default '', received_at, body_html, body_text, bank_code, parsed_at, parse_error, timestamps | unique (user_id, message_id), index bank_code |
| `categories` | id, user_id (nullable = system), parent_id (self FK, set null), name, icon (≤16), type `expense|income|debt_loan`, order int default 0, timestamps | |
| `transactions` | id, user_id, raw_email_id (unique, nullable, set null), bank_code (`manual` for manual), direction `in|out`, amount int (VND), currency char(3) nullable, original_amount int nullable, amount_estimated bool, **unverified bool default false**, counterparty, counterparty_account, description, reference, occurred_at (UTC), category_id (set null), note, deleted_at, timestamps | index (user_id, occurred_at) |
| `category_rules` | id, user_id, match_field `account|counterparty|description`, match_value (stored folded), category_id (cascade), timestamps | unique (user_id, match_field, match_value) |
| `inbound_receipts` | id (sha256 of the raw message), received_at | replay protection for the webhook; rows older than 1 day are purged daily |
| `jobs` | see phase 4 | |
| `cache` | key (pk), value text, expires_at int | rate limits |

`transactions.unverified` mirrors `raw_emails.verification = 'unverified'` so totals and reports filter on one indexed table. When the user confirms an unverified transaction, the flag is cleared on the transaction and `raw_emails.verification` becomes `user_confirmed`, so a later reparse keeps it confirmed.

Store timestamps as integer milliseconds (Drizzle `integer({ mode: 'timestamp_ms' })`) in UTC. Enable `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000` on every connection.

## Files to Create

- `apps/server/src/db/client.ts` (opens SQLite, pragmas, exports `db`)
- `apps/server/src/db/schema.ts` (tables above + relations), `apps/server/drizzle.config.ts`, generated `apps/server/drizzle/0000_*.sql`
- `apps/server/src/db/seed/system-categories.ts` (data array + idempotent `seedSystemCategories()` that inserts missing rows by (name, type), resolves parent by name, and on a new row moves user copies' transactions and rules to it, then deletes the copies, in one transaction)
- `apps/server/src/db/seed/index.ts` (`bun run db:seed` entry)
- `apps/server/src/lib/tokens.ts` (`newInboundToken()` from `crypto.getRandomValues`, base32 lowercase)
- `packages/shared/src/enums.ts` (Direction, CategoryType, MatchField, EmailSource, Verification, Locale, Theme, `DEBT_LOAN_DIRECTIONS`, `MANUAL_BANK_CODE`)
- `apps/server/src/domain/categories.ts` (query helpers `availableTo(userId)`, `ordered`, `fitting(direction)`, `fits(category, direction)`, `color(id)`)

## Tasks & Steps

1. Write the schema and generate the initial migration; `bun run db:migrate` applies it.
2. Port the 44 system categories exactly (names are English translation keys, emoji icons, order, parent).
3. Unit tests: seeder is idempotent (run twice → 44 rows) and merges a user copy (transactions and rules move); `fitting` returns expense + matching debt/loan for `out` and income + matching debt/loan for `in`; a second active inbound address for the same user violates the partial unique index; tokens are 26 chars and unique across 10k draws.

## Verification

- `bun test apps/server/src/db apps/server/src/domain/categories` passes.
- `sqlite3 storage/bank-sync.sqlite .schema` shows the constraints listed above.

## Risks

- Losing a unique constraint breaks dedupe or rule upserts. Mitigation: tests that insert duplicates and expect a constraint error.
- The inbound token is a routing key, not the security boundary; DKIM is (phase 4). Still, log addresses by row id, never by token value, so logs do not hand out addresses that could be spammed.
