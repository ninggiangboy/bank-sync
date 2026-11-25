# Architecture

How Bank Sync is laid out, how a bank email becomes a transaction, and why it works that way.
Behavior details live in the code and tests linked here.

## Workspace

| Package               | Role                                                             | Entry point                                                                                              |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/server`         | Elysia API, email ingest, job worker, scheduler, CLI             | [`src/index.ts`](../apps/server/src/index.ts), routes wired in [`src/app.ts`](../apps/server/src/app.ts) |
| `apps/web`            | React SPA, typed against the server with Eden Treaty             | [`src/main.tsx`](../apps/web/src/main.tsx)                                                               |
| `apps/inbound-worker` | Cloudflare Email Worker that relays forwarded mail to the server | [`src/index.ts`](../apps/inbound-worker/src/index.ts)                                                    |
| `packages/shared`     | Types and constants used by both server and web                  | [`src/index.ts`](../packages/shared/src/index.ts)                                                        |

Configuration is validated in [`apps/server/src/config/env.ts`](../apps/server/src/config/env.ts);
[`.env.example`](../.env.example) explains each setting. The database schema is
[`apps/server/src/db/schema.ts`](../apps/server/src/db/schema.ts) with migrations in
`apps/server/drizzle/`.

## From bank email to transaction

```text
Gmail filter ─▶ Cloudflare Email Routing ─▶ Email Worker ─▶ POST /api/inbound/email
   ─▶ receipt + pending file ─▶ ingest-email job (DKIM) ─▶ parse-raw-email job ─▶ transaction
```

1. Each user has an unguessable inbound address on `INBOUND_DOMAIN`
   ([`domain/inbound-addresses.ts`](../apps/server/src/domain/inbound-addresses.ts)). The forwarding
   settings give them the Gmail filter and Gmail's forwarding confirmation code.
2. The Worker passes on only mail from a configured bank sender or Gmail's forwarding confirmation,
   signs it with an HMAC over timestamp, recipient and body, and posts the raw MIME.
3. The inbound route ([`inbound/route.ts`](../apps/server/src/inbound/route.ts)) checks the
   signature and clock skew, drops replays, stores the bytes as a pending file and queues a job. It
   does no parsing inside the request.
4. Jobs ([`jobs/`](../apps/server/src/jobs)) verify DKIM
   ([`inbound/dkim.ts`](../apps/server/src/inbound/dkim.ts)), store the raw email, pick a parser
   ([`parsing/parser-registry.ts`](../apps/server/src/parsing/parser-registry.ts)) and write the
   transaction with its category.

History uploads ([`inbound/import-upload.ts`](../apps/server/src/inbound/import-upload.ts)) and the
`import-eml` CLI command join the same pipeline at step 4.

The end-to-end path is covered by
[`test/jobs/pipeline.test.ts`](../apps/server/test/jobs/pipeline.test.ts) and
[`test/inbound/`](../apps/server/test/inbound), the Worker by
[`apps/inbound-worker/test/worker.test.ts`](../apps/inbound-worker/test/worker.test.ts).

## Bank parsers

Supported banks are listed once, in
[`parsing/banks-config.ts`](../apps/server/src/parsing/banks-config.ts): sender addresses, the
directions each bank reports, and its parser. Every other sender list derives from it, including
the Worker's allow-list, which is generated and checked by a test so the two cannot drift. Parsers
must reproduce the upstream fixtures exactly; see
[adding a bank parser](adding-a-bank-parser.md).

## Decisions

**Email forwarding, not IMAP.** Users never give the app a Google app password. The trade-off:
forwarding only carries new mail (history comes from `.eml`/`.mbox` uploads), Google Workspace
organisations may block forwarding, and a broken filter fails silently, so the app shows when mail
last arrived per bank. Alternatives and the evidence are in the
[decision report](../plans/reports/advise-261125-1347-gmail-forwarding-ingest.md).

**DKIM is the only proof of origin.** Forwarded mail always fails SPF. A signature counts only if it
passes, its `d=` is the From domain or a parent of it, and it covers the whole body; the From
address must be a configured bank sender. Cloudflare's own authentication results are ignored.
Mail that fails is kept but its transaction is unverified and excluded from every total until the
user confirms it. Uploaded files skip the check, because old DKIM keys rotate and an uploader can
only affect their own data.

**Accept and discard non-bank mail.** The Worker silently drops mail from unknown senders instead of
bouncing it, and mail to an unknown or retired address is rejected. Neither the Worker nor the
server logs message content, and the server never fetches links found in an email; the user confirms
Gmail forwarding themselves.

**Delivery failures surface to Cloudflare.** When the server cannot take a message, the Worker
throws so the delivery is reported as failed rather than accepted and lost. A failed ingest keeps
its pending file for the retry; a daily purge removes leftovers.

**Replay protection is per recipient.** The HMAC includes the recipient, and replay receipts are
keyed by message hash plus inbound address, so one email forwarded to two users reaches both.

**SQLite for everything, one process.** Data, the job queue
([`queue/`](../apps/server/src/queue)), the cache and the scheduler
([`scheduler.ts`](../apps/server/src/scheduler.ts)) all live in one SQLite database and one Bun
process. There is no Redis. `WORKER_ENABLED` and `SCHEDULER_ENABLED` exist so that only one
instance runs them.

**Migrations run with foreign keys off.** drizzle-kit rebuilds a table by dropping it, and SQLite
ignores `PRAGMA foreign_keys=OFF` inside a transaction, so a rebuild with keys on would
cascade-delete user data. [`db/migrate.ts`](../apps/server/src/db/migrate.ts) turns keys off around
the run and checks them afterwards; a test replays a rebuild. Bank Sync installs fresh: there is no
import from a SpendSync deployment.

**Fail closed on configuration.** An unset `NODE_ENV` means production, which requires real URLs,
the inbound domain and both secrets. A missing variable must never fall back to development
defaults such as random secrets or verbose errors.

**The demo account is read-only for everyone.** While a user views the demo, every mutating route
answers `demo_read_only`, including changes to the viewer's own settings. Writes go through
`writeContext` in [`domain/demo.ts`](../apps/server/src/domain/demo.ts), and a test walks every
registered mutating route, so a new unguarded route fails it.

**Account changes go through Bank Sync's routes.** Better Auth's own delete-user, update-user and
change-password endpoints bypass the password and demo guards, so they answer 404
([`auth/`](../apps/server/src/auth)).

**AGPL-3.0-only.** The license and upstream credit stay with the code ([`NOTICE.md`](../NOTICE.md)),
and the app links to its source through `APP_SOURCE_URL`.

## Not yet verified against real systems

These assumptions behind the ingest design still need a real check:

- Vietcombank, CAKE and VPBank DKIM signatures survive Gmail forwarding.
- Cloudflare tells Gmail to retry, rather than bouncing, when the Worker throws.
- Email Routing works on a subdomain such as `in.<domain>`.
- Importing the generated Gmail filter `.xml` keeps its forward action.
