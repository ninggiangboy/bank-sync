# Xia port analysis: SpendSync → Bank Sync (Elysia + Vite React)

Mode: `--port` (rewrite idiomatically for the new stack). Scope: the whole application, at feature parity.

## Source manifest

| Field | Value |
| --- | --- |
| Repository | https://github.com/henrybuidotdev/spendsync |
| Branch / commit | default branch, `ba44f1fc9750f89cb8d0b169aa184fa050ced959` (2026-11-25, "Initial commit") |
| Path scope | Whole repository. About 7.9k lines of app code plus 351 Pest tests and 28 `.eml` fixtures |
| License | **AGPL-3.0-only**. The port reuses the parser logic, fixtures, translations and legal copy, so it is a derivative work: it must stay AGPL-3.0, keep the upstream copyright notice, credit the source, and show users a link to its own source code (the source has `APP_SOURCE_URL` for this) |
| Local target | `/home/rb071/dev/ninggiangboy/bank-sync`: empty directory, not a git repository yet |

## What the app does

SpendSync is a mobile-first spending tracker for Vietnamese bank customers. The user connects Gmail with a Google app password. The app reads, over read-only IMAP, only emails from supported bank senders (Vietcombank, CAKE, VPBank). It parses each one into a transaction (amount, direction, counterparty, account, time, description, reference, foreign currency) and shows the results in an installable PWA. There the user categorizes transactions, creates auto-categorize rules, and sees monthly reports.

```
Gmail ─IMAP SEARCH FROM+SINCE─▶ SyncMailAccount ─firstOrCreate(user,message_id)─▶ raw_emails
                                                           │
                                                ParseRawEmail (queued)
                                                           │
        ParserRegistry.findFor(from) ─▶ BankParser.parse() ─▶ transactions ─▶ CategoryMatcher
```

## Source anatomy

| Layer | Source files | Behavior to preserve |
| --- | --- | --- |
| Schema | 24 migrations whose end state is 7 domain tables: `users`, `user_settings`, `mail_accounts`, `raw_emails`, `transactions` (soft delete), `categories` (shared system rows have `user_id` NULL, a `parent_id` tree, `order`), `category_rules` | Unique `(user_id, message_id)`, unique `raw_email_id`, unique `(user_id, match_field, match_value)`, cascading deletes on user, `null` on delete of category |
| Seed | `SystemCategorySeeder` (44 categories incl. 4 fixed debt/loan), `DemoSeeder` + `DemoLedger` (seeded deterministic ~3.5-month ledger) | Re-runnable seeder that merges matching user copies; demo imports fixtures through the real pipeline |
| Parsing | `Parsing/Support/{TextNormalizer,MoneyParser,DateParser,BalanceRedactor,ExchangeRates}`, `AbstractBankParser`, `Banks/{Vietcombank,Cake,VpBank}Parser`, `ParserRegistry` | HTML→text flattening, NFC, VND and foreign amounts, sign- or keyword-based direction, Vietnamese diacritic folding, balance masking before storage, FX estimate fallback |
| Mail | `MailboxClient` interface, `WebklexGmailClient`, `FakeMailboxClient`, `FetchedMessage` | `imap.gmail.com:993` TLS, All Mail folder fallback to INBOX, `FROM`+`SINCE`(+`BEFORE`) per sender, PEEK (never marks read), never leaks the password |
| Jobs | `SyncMailAccount` (unique per account, 15-day windows, 2 tries, 600 s timeout), `ParseRawEmail` | Window walking, `needs_reconnect` on bad credentials, `last_synced_at` / `last_run_at` bookkeeping, syncing flag (5 min TTL) |
| Scheduler | `routes/console.php` | Every minute: active accounts with `id % 60 = minute` and `last_run_at` older than 30 min; FX rates daily 08:00; demo refresh 00:05 local |
| Categorization | `CategoryMatcher` | Rule priority account → counterparty → description; category must fit direction; remember/forget/backfill/draft/follows |
| Demo | `Support/Demo`, global Eloquent saving/deleting listener, `BlocksDemoWrites` | Signed-in users can view the demo account read-only; every write to demo-owned rows is refused while a user is signed in |
| UI (Livewire) | `Transactions/{Index,Show,Form}`, `Reports`, `Settings` (gmail/categories/rules/appearance), `ConnectGmail`, Breeze auth + profile pages, `home`, `privacy/{vi,en}`, `terms/{vi,en}` | Month switcher via `?month=YYYY-MM`, filters, category/payee scope, sync banner polling every 3 s, toasts, read-only demo toast |
| i18n | `lang/vi.json` (301 keys), `lang/{vi,en}/*.php` | Vietnamese default, English fallback, locale + theme mirrored in cookies for signed-out pages |
| Styling | Tailwind 3 + a custom palette that remaps slate/emerald/etc. and mirrors scales in dark mode, 8 chart colors | Same look in light and dark |
| PWA | `public/sw.js` (caches hashed build assets only), `manifest.webmanifest` | Installable, no offline data |
| CLI | `spendsync:{sync,reparse,import-eml,refresh-demo,parse-stats,update-exchange-rates}` | Same operator commands |
| Tests | 351 Pest tests: fixture-driven parser test, pipeline, UI, data model, demo, matcher, auth, browser | Fixture `*.expected.json` contract is the parity oracle |

## Dependency matrix

Local project is empty, so every component is `NEW`. The column below records the equivalent chosen for each source dependency.

| Source dependency | Target equivalent | Status |
| --- | --- | --- |
| PHP 8.4 / Laravel 13 | Bun 1.4 + Elysia 1.4.32 | NEW |
| Livewire 3 + Volt + Alpine + Blade | React 19.3 SPA, Vite 8.3, TanStack Router 1.170 + Query 5.108, Eden Treaty 1.4 | NEW |
| Eloquent + SQLite | Drizzle ORM 0.45 + `bun:sqlite`, drizzle-kit 0.31 | NEW |
| Breeze (session auth, verify, reset) | Better Auth 1.7 (email/password, verification, reset, cookie sessions, Drizzle adapter) | NEW |
| Laravel `encrypted` cast | Not needed: no Google credential is stored (superseded 2026-11-25, see the forwarding decision) | REMOVED |
| Database queue + `ShouldBeUnique` | SQLite `jobs` table + in-process worker loop, unique key column | NEW (user decision) |
| Horizon / Redis | Dropped | REMOVED (user decision) |
| Laravel scheduler | `@elysiajs/cron` 1.4 in the same process | NEW |
| webklex/php-imap | Gmail filter forwarding → Cloudflare Email Routing + Email Worker (wrangler 4.168) → HMAC webhook; DKIM via mailauth 8.1; MIME via mailparser 3.15; history via `.eml`/`.mbox` upload (superseded the imapflow choice on 2026-11-25) | NEW |
| intl `Normalizer`, PCRE | `String.prototype.normalize`, JS `RegExp` with the `u` flag | CONFLICT: regex semantics differ (see risks) |
| Laravel Cache / RateLimiter | SQLite `cache` table with expiry | NEW |
| Laravel Mail (log driver default) | nodemailer 10 (SMTP, log transport when unset) | NEW |
| Laravel HTTP client (FX download) | `fetch` with timeout + retry | NEW |
| Tailwind 3 config palette | Tailwind 4.3 `@theme` CSS variables + `dark` variant | NEW |
| Laravel translations | i18next 27 + react-i18next 18 (client), error codes from server | NEW |
| Pest / Pest Browser | `bun test` + Playwright 1.65 | NEW |

## Decision matrix

| # | Decision | Source's way | Our way | Risk | Choice |
| --- | --- | --- | --- | --- | --- |
| 1 | Runtime | PHP-FPM / artisan serve | Bun (Elysia is Bun-first) | low | Bun |
| 2 | Repo layout | Monolith | Bun workspaces: `apps/server`, `apps/web`, `packages/shared`; Elysia serves `apps/web/dist` in production (single deploy, same origin) | low | port |
| 3 | Rendering | Server-rendered Livewire | Client SPA over a JSON API, typed end to end with Eden Treaty | medium | port |
| 4 | Database | SQLite | SQLite via Drizzle + `bun:sqlite` (WAL) | low | same (user decision) |
| 5 | Migrations | 24 incremental | One initial migration with the final schema; system categories come from the seeder | low | adapt (fresh install, no data import) |
| 6 | Auth | Breeze sessions | Better Auth; the 4 domain tables reference its `user.id` (text). "Confirm password" becomes a password field on the dangerous actions | medium | adapt |
| 7 | Queue | Database queue, Redis optional | SQLite job table, single worker in the server process, Horizon removed | low | user decision |
| 8 | Tenant isolation | Policies + scoped relations | Every repository function takes the owner id; one `requireOwned()` helper; isolation tests per resource | high if missed | port |
| 9 | Demo read-only | Global Eloquent saving/deleting listener | All writes go through service functions that call `assertWritable(ownerId)`; HTTP layer maps the error to `403 demo_read_only`; background jobs pass a system context that skips the check | high if missed | adapt |
| 10 | i18n | `__()` server side | Server returns stable error codes; the client translates. Port `vi.json` to `vi`/`en` JSON resources | low | port |
| 11 | PWA | Hand-written `sw.js` | Keep a hand-written service worker that caches `/assets/*` (Vite hashed files) only | low | port |
| 12 | Product name | SpendSync | **Bank Sync** in UI, manifest, legal pages and README, with upstream credit | low | user decision |
| 13 | Getting bank emails | Gmail app password + read-only IMAP, hourly sync | Per-user forwarding address, Cloudflare Email Routing + Worker, DKIM check, unverified state, history upload ([decision](./advise-261125-1347-gmail-forwarding-ingest.md)) | medium | user decision, 2026-11-25 |

## Risk score

Critical assumptions (being wrong means a security issue, data loss, or more than two days of rework):

1. Parser regex fidelity from PCRE to JS (`\b`, `\p{..}`, `/x` extended mode, `html_entity_decode`, multiline anchors). Guarded by porting every fixture with its `expected.json` first.
2. Tenant isolation across all endpoints. Guarded by isolation tests per resource.
3. Demo read-only enforcement without a global ORM hook. Guarded by a test that calls every mutating endpoint while viewing demo.
4. ~~App password secrecy~~ (removed with IMAP on 2026-11-25). Replaced by **origin of forwarded mail**: a forged email posted to a user's address must never count as a verified transaction. Guarded by HMAC on the webhook, DKIM alignment checks, and the unverified state; the real-world DKIM behavior of each bank is checked first in phase 4.

Four critical items → **Medium** risk. The plan resolves all four in the phases where they first appear (3, 2/6, 6, 4) before the UI is built on top of them.

## Non-goals

- Importing data from an existing Laravel deployment (no migration script).
- IMAP, Google app passwords, and OAuth / Gmail API.
- Redis, BullMQ and a Horizon-style dashboard.
- Server-side rendering. Landing and legal pages ship as SPA routes with static meta tags in `index.html`.
- New features beyond the source.
