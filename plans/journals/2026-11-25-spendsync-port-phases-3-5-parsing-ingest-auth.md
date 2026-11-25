---
title: "SpendSync port phases 3-5: parsing, ingest and auth"
date: 2026-11-25
summary: "Parsing engine at fixture parity, DKIM-checked forwarded-mail ingest with a SQLite queue, and Better Auth accounts landed; real-bank DKIM and Cloudflare behavior remain unverified."
---

# SpendSync port phases 3-5: parsing, ingest and auth

## What happened

Phases 3, 4 and 5 of `plans/261125-0632-spendsync-port-elysia-react` landed on `feat/spendsync-port` (255 tests, typecheck and lint green):

- **Parsing:** all upstream fixtures parse to their `expected.json`. The plan said 28 fixtures; upstream has 20 `.eml` files. mailparser invents a wrapped `text` for HTML-only mail, which defeated balance redaction, so `fromEml` keeps `text` only when a real `text/plain` part exists.
- **Ingest:** HMAC-signed webhook from the Cloudflare Email Worker, DKIM verification with `mailauth` (works under Bun with an injected resolver), SQLite job queue and worker, scheduler, `.eml`/`.mbox` upload, CLI and the Worker itself.
- **Auth:** Better Auth with login throttling by email and address, profile, password change, delete data and account, and locale/theme settings mirrored to cookies.

Gotchas:

- Drizzle's `run()` is typed `void` on `bun:sqlite`; count rows with `.returning().all().length`.
- Better Auth skips its origin check under test and applies a 3-per-10-seconds sign-in rule that collides with the 5-per-minute policy; both were configured explicitly.
- Replay receipts are keyed by message hash plus address id so one email forwarded to two users is not dropped.

## Decision

- A failed ingest keeps its pending file for the retry; the daily purge removes leftovers.
- `createApp` takes `{ db, files, mailer }` and builds auth itself, so importing the app never opens the real database.

## Next steps

Phase 6 (domain API). Still needed from the user: one real forwarded email per bank to confirm DKIM survives Gmail forwarding, and checks of Cloudflare Worker failure behavior, subdomain routing and Gmail filter import. An independent review then found and confirmed, and these were fixed: Better Auth's own `/delete-user`, `/update-user` and `/change-password` bypassed the password and demo guards (now answer 404); parallel sign-in guesses escaped the throttle (attempts are now counted before the password check); Gmail confirmation mail was not DKIM-checked; a long DNS outage lost bank mail (the last attempt now stores it unverified); the inbound endpoint buffered large unsigned bodies; a malformed cookie caused 500s; sessions now end on password change or reset; a crash-looping job now fails. The recipient is now part of the HMAC (user-approved change to the planned format), confirmations are unique per user and code, and the From address DKIM checked must equal the stored one.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
