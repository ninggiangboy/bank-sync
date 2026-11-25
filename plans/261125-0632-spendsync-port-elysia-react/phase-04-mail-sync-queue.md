---
phase: 4
title: "Email ingest, DKIM, job queue, scheduler, CLI"
status: done
priority: P1
effort: "9h"
dependencies: [2, 3]
---

# Phase 4: Email ingest, DKIM, job queue, scheduler, CLI

## Goal

Receive forwarded bank emails from a Cloudflare Email Worker, prove their origin with DKIM, store them deduplicated with balances masked, parse them on a SQLite-backed queue, auto-categorize, import history from uploaded `.eml` / `.mbox` files, and run the remaining upstream schedules and operator commands. There is no IMAP and no stored Google credential.

## References

- Decision and rules: [advise report](../reports/advise-261125-1347-gmail-forwarding-ingest.md). Its "Rules the implementation must follow" are acceptance criteria for this phase.
- Upstream: `app/Jobs/ParseRawEmail.php`, `app/Models/RawEmail.php` (`storeFetched`, redaction on write), `app/Categorization/CategoryMatcher.php`, `app/Console/Commands/*`, `routes/console.php`, `config/services.php` (`fx`, `demo`), `tests/Feature/PipelineTest.php`, `CategoryMatcherTest.php`.
- Upstream code that is **not** ported: `app/Mail/Inbox/*`, `app/Jobs/SyncMailAccount.php`, the per-minute sync schedule, `spendsync:sync`.

## Flow

```
Gmail filter ─forward─▶ Cloudflare Email Routing (*@INBOUND_DOMAIN) ─▶ Email Worker
   Worker: sender allow-list → POST /api/inbound/email (raw MIME, HMAC, timestamp)
   Server: verify HMAC + timestamp + replay → resolve recipient token → store raw → 200
   Job ingest-email: Gmail confirmation? → save code/link
                     bank sender? → DKIM check → raw_emails (verification) → parse-raw-email job
Upload .eml/.mbox ─▶ same store path with source=upload, verification=user_upload
```

## Files to Create

- `apps/server/src/inbound/route.ts`: `POST /api/inbound/email` (no session auth). Headers `X-Inbound-Timestamp` (unix seconds), `X-Inbound-Signature` = hex HMAC-SHA256 of `timestamp + "." + sha256(body)` with `INBOUND_WEBHOOK_SECRET`, `X-Inbound-Recipient` (envelope `to`). Body: raw MIME (`message/rfc822`), capped at `INBOUND_MAX_BYTES`. Steps: constant-time signature check and |now − timestamp| ≤ 300 s, else 401; insert sha256 into `inbound_receipts` and answer 200 without work if it already exists (replay or Worker retry); resolve the token from the recipient local part among active addresses, else 404 (the Worker turns this into a reject); write the raw bytes to `storage/inbound/<sha256>.eml` (deleted after processing), enqueue `ingest-email` with `{ sha256, inboundAddressId }`; answer 200. No parsing in the request.
- `apps/server/src/inbound/dkim.ts`: wraps `mailauth`'s DKIM verification. Returns `{ pass: boolean, domain?: string }` where pass requires: a signature with result `pass`; `d=` equal to the From address domain or a parent domain of it; no `l=` tag, or `l=` ≥ the canonicalized body length. Ignores `Authentication-Results` / `ARC-*` headers added by Google or Cloudflare.
- `apps/server/src/inbound/gmail-confirmation.ts`: recognizes mail from `forwarding-noreply@google.com`; extracts the numeric confirmation code, the confirmation URL (only an `https://mail.google.com/` or `https://mail-settings.google.com/` link; anything else is ignored), and the Gmail address that asked to forward. Never fetches the URL.
- `apps/server/src/jobs/ingest-email.ts`: loads the pending raw message; if it is a Gmail confirmation → upsert into `forwarding_confirmations` (keep last 5), done; parse with `fromEml` (phase 3); if the lowercase From is not a configured bank sender → discard silently (log only `inbound_address_id` and `reason=not_bank_sender`, never content); otherwise run DKIM and call `storeEmail` with `source=forward`, `verification = pass ? dkim_pass : unverified`, `dkim_domain`. Always delete the pending blob.
- `apps/server/src/inbound/import-upload.ts`: accepts one or more `.eml` files or one `.mbox` file (≤ `UPLOAD_MAX_BYTES`). `.mbox` is read as a stream and split on `From ` separator lines with mboxrd `>From ` unescaping. Each message: parse, keep only bank senders, `storeEmail` with `source=upload`, `verification=user_upload`, no DKIM gate. Returns `{ imported, duplicates, skipped }`.
- `apps/server/src/domain/raw-emails.ts`: `storeEmail({ userId, inboundAddressId?, source, verification, dkimDomain?, message })` does insert-or-ignore on (user_id, message_id), redacts both bodies on write, truncates message_id/from/subject to 250 chars, and enqueues `parse-raw-email` only when the row is new. Returns `{ row, created }`.
- `apps/server/src/queue/jobs-table.ts` (id, name, payload json, unique_key nullable with a partial unique index on pending jobs, attempts, max_attempts, available_at, reserved_at, last_error, created_at), `apps/server/src/queue/queue.ts` (`dispatch(name, payload, { uniqueKey, delayMs })`), `apps/server/src/queue/worker.ts` (poll loop, claim one job atomically, per-job timeout, retry with backoff up to `max_attempts`, recover stale reservations, graceful stop on SIGTERM).
- `apps/server/src/cache/kv-cache.ts` (`hit/tooManyAttempts/availableIn` over the `cache` table, for rate limits).
- `apps/server/src/jobs/parse-raw-email.ts`, `apps/server/src/domain/category-matcher.ts` (see behavior below).
- `apps/server/src/scheduler.ts` (`@elysiajs/cron`: 08:00 daily FX update; 00:05 `APP_TIMEZONE` demo refresh; 03:00 daily purge of `inbound_receipts` older than 1 day and orphaned pending blobs).
- `apps/server/src/cli/index.ts` and commands: `reparse [--failed] [--bank=]`, `import-eml <user> <path>` (files or folders, recursive; uses `storeEmail` with `source=upload`), `refresh-demo`, `parse-stats`, `update-exchange-rates`, `inbound-address <user>` (prints the active address), `key:generate` (prints random values for `BETTER_AUTH_SECRET` and `INBOUND_WEBHOOK_SECRET`).
- `apps/inbound-worker/src/index.ts` + `apps/inbound-worker/wrangler.toml`: the Email Worker `email(message, env, ctx)` handler. Reads `message.from` and the `From` header; if neither is a configured bank sender nor `forwarding-noreply@google.com`, it returns without doing anything (accept and drop; never `setReject` for this case). Otherwise it reads `message.raw` (refuses over the size cap), signs and POSTs it to `env.INBOUND_URL` with `X-Inbound-Recipient: message.to`. On 404 it calls `message.setReject('Unknown address')`. On network error or 5xx it throws so Cloudflare reports a failure (the exact retry behavior is in Unverified below). It never logs headers or content. The sender allow-list is generated at build time from `apps/server/src/parsing/banks-config.ts` so it cannot drift.
- Tests under `apps/server/test/{inbound,queue,jobs,matcher,cli}` and `apps/inbound-worker/test`.

## Behavior kept from upstream

- Parse job: unknown sender → `parse_error = unsupported_sender`; parser error → store the reason and log only `raw_email_id`, `bank_code`, `reason`; success → `parsed_at`, upsert the transaction by `raw_email_id` including soft-deleted rows, keep category and note on reparse, set `transactions.unverified = (raw_emails.verification = 'unverified')`, run the matcher only when the category is empty. Deletes itself if the raw email is gone.
- Category matcher: rules ordered account → counterparty → description; a rule applies only when its category fits the direction; `remember`, `forget` (only when the rule points to this transaction's category), `ruleFor`, `follows`, `ruleField`, `backfill`, `backfillCount`, `draft`. Folding uses `TextNormalizer.fold`.
- FX update: GET `https://open.er-api.com/v6/latest/USD` with 15 s timeout and 2 retries; on success save VND-per-unit rates and requeue raw emails with `parse_error = currency_unsupported`; on failure keep old rates and exit non-zero.
- Demo refresh: shift every demo transaction (including hidden) and raw email by whole days so the newest is today in `APP_TIMEZONE`.
- The demo seed (it needs a Better Auth user) lives in phase 6; this phase provides `import-eml` and `refresh-demo`.

## Tasks & Steps

1. **First, settle the DKIM assumption.** Ask the user for one real bank email per bank (VCB, CAKE, VPB) forwarded through Gmail with full headers, and run `dkim.ts` on them. Record the result per bank in the advise report. If a bank fails, keep going (those emails become unverified, as decided) but tell the user which bank.
2. Confirm `mailauth` 8.1.0 runs under Bun (DNS lookups through `node:dns`). If it does not, run DKIM verification with mailauth's injectable resolver backed by `Bun.dns` or a DNS-over-HTTPS fetch.
3. Build queue + worker, then `storeEmail`, then the inbound route, then `ingest-email`, then uploads, then the Worker.
4. Port `PipelineTest.php` cases onto the new entry points: fixture → inbound route → stored → parsed → categorized; dedupe; unsupported sender.

## Verification

`bun test apps/server/test apps/inbound-worker/test` passes, including:
- Bad HMAC → 401; timestamp 301 s old → 401; same body twice → second is a no-op 200; unknown or replaced token → 404.
- Fixture with a valid DKIM signature (generate a test key pair, sign fixtures in the test, and point the resolver at a fake DNS answer) → `dkim_pass`; signature from another domain → `unverified`; body altered after signing → `unverified`; `l=` shorter than the body → `unverified`.
- Unverified email → transaction with `unverified = true`.
- Non-bank email → nothing stored, nothing logged except the reason.
- Gmail confirmation sample (write a synthetic one modeled on Google's format) → code and URL saved; a non-Google URL in it is ignored.
- `.mbox` with 3 bank emails, 1 non-bank email and 1 `>From ` escaped line → 3 imported; uploading again → 3 duplicates; the same message forwarded and uploaded → one transaction.
- Worker: non-bank sender → no fetch; bank sender → signed POST; 404 → `setReject`.
- `grep -ri "imap\|app_password" apps/` returns nothing.

## Risks

- Banks that do not DKIM-sign, or signatures broken by forwarding, turn every email of that bank into a manual confirmation. Mitigation: step 1 before building on it; the UI explains why a transaction is unverified.
- Mail lost while the server is down. Mitigation: the request path only stores and returns; the Worker surfaces failures so Cloudflare does not silently accept them (see Unverified). If Cloudflare turns out to accept and drop on Worker errors, add a Cloudflare Queue between Worker and server as a follow-up and tell the user, since it adds infrastructure.

## Unverified (carry into implementation)

- Cloudflare's behavior when an Email Worker throws (temporary failure that makes Gmail retry, or permanent bounce). Read the current Email Workers docs and test with the server stopped.
- Gmail keeps the original `Message-ID` on auto-forward (needed for dedupe between forwarded and uploaded copies). Check on the real samples from step 1.

## Carried over from phases 1–2

- The `jobs` table was left to this phase. Export it from `apps/server/src/db/schema.ts` and run `bun run db:generate`. While nothing is deployed, regenerate `0000_initial_schema` instead of adding `0001`, to keep "one initial migration".
- Drizzle's `bun:sqlite` `transaction()` is synchronous. An `async` callback commits at its first `await`, and later statements run outside the transaction. Keep worker claims and `storeEmail` callbacks synchronous, and pass `{ behavior: "immediate" }` for read-then-write transactions.
- Throw `HttpError(status, code)` or `status(code, "error_code")`. Both become `{ error: { code } }`.

## Handover notes (implementation)

- `mailauth` 8.1.0 runs under Bun with an injected resolver; DKIM tests sign fixtures with a generated key. Step 1 (real forwarded emails per bank) still needs the user: until then, whether VCB, CAKE and VPB signatures survive Gmail forwarding is **unverified**, and unsigned or broken mail simply becomes unverified.
- Not yet verified against Cloudflare: what a throwing Email Worker does, whether Gmail keeps `Message-ID` on forward, Email Routing on a subdomain, and the Gmail filter `.xml` import. The Worker throws on 5xx/network errors and on any non-404 failure.
- Replay receipts and pending files are keyed `<sha256>-<inboundAddressId>`, so one email forwarded to two users is not dropped as a replay. A failed ingest keeps its pending file for the retry; the 03:00 purge removes leftovers older than a day.
- `jobs` has an extra `failed_at` column; the pending unique index covers rows where `reserved_at` and `failed_at` are null. The migration `0000_initial_schema` was regenerated.
- Drizzle's `run()` is typed `void` on `bun:sqlite`; count affected rows with `.returning(...).all().length`.
- The upstream fixture set has 20 `.eml` files (40 files with their `.expected.json`), not 28.
- `app.ts` now exports `createApp({ db, files })` and the `App` type; `index.ts` migrates, starts the worker (`WORKER_ENABLED`) and scheduler (`SCHEDULER_ENABLED`). New env: `STORAGE_PATH`.
- The Worker's sender allow-list is `apps/inbound-worker/src/senders.generated.ts` (`bun run --filter @bank-sync/inbound-worker generate`); a test fails when it drifts from `banks-config.ts`.
