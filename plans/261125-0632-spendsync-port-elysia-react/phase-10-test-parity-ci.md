---
phase: 10
title: "Test parity and CI"
status: pending
priority: P1
effort: "8h"
dependencies: [9]
---

# Phase 10: Test parity and CI

## Goal

Close the gap between the 351 upstream Pest tests and the port, add browser tests for the critical flows (including forwarding setup and unverified transactions), and run everything in CI.

## Source references

- `.upstream/spendsync/tests/**` (Unit, Feature, Feature/Auth, Browser), `.github/workflows/tests.yml`
- [advise report](../reports/advise-261125-1347-gmail-forwarding-ingest.md) for the forwarding rules under test

## Files to Create

- `docs/testing.md`: a table mapping each upstream test file to its port file, plus the cases dropped on purpose and why (IMAP connect, sync windows and reconnect status are gone with forwarding; Blade markup details are covered by API and Playwright checks instead; the Horizon gate no longer exists)
- `apps/server/test/helpers/inbound.ts`: signs a raw email with the test `INBOUND_WEBHOOK_SECRET` and posts it to `/api/inbound/email`; optionally DKIM-signs it with a test key whose public key the test DNS resolver returns
- `e2e/playwright.config.ts`, `e2e/*.spec.ts`
- `.github/workflows/ci.yml`

## Tasks & Steps

1. Walk each upstream test file and confirm every behavioral case that still applies has a ported test in phases 2–6. Add the missing ones. Cases that only assert Blade markup become Playwright assertions or are listed as dropped with a reason.
2. Playwright specs (server on a temp SQLite DB with the demo seed; the test DNS resolver for DKIM is enabled only when `NODE_ENV=test`):
   - register → `/connect` shows an address → post a synthetic Gmail confirmation email through the helper → the code appears on screen without reload → post a DKIM-signed fixture → the transaction appears on `/transactions`
   - post an unsigned fixture → the row shows "unverified", totals exclude it → confirm on the detail page → totals include it
   - upload a `.mbox` with fixtures → result counts shown → transactions appear; uploading again reports duplicates
   - rotate the address → posting to the old address is rejected
   - manual transaction add/edit/delete (port of `tests/Browser/ManualTransactionTest.php`)
   - set category → apply to future → rule shows in settings → back/forward shows fresh data
   - demo mode: view demo, try a write, see the read-only toast, exit demo
   - language and theme switch persist after logout
3. CI on push and PR: Bun setup, `bun install --frozen-lockfile`, `lint`, `typecheck`, `bun test` (server, shared, Worker), `bun run build`, Playwright with Chromium.
4. Run `/ak-code-review` (or the code-reviewer agent) over the whole port, focusing on tenant isolation, the demo guard, the inbound endpoint (HMAC, replay, size caps, recipient resolution), DKIM alignment and `l=` handling, the Worker never logging content, and parser fidelity; fix findings.

## Verification

- `bun run lint && bun run typecheck && bun test && bun run build && bunx playwright test` all pass locally and in CI.
- `docs/testing.md` accounts for every upstream test file.

## Risks

- The test DNS resolver or a test signing secret leaking into production would let anyone forge "verified" emails. Mitigation: the server refuses to start with the test resolver enabled unless `NODE_ENV=test`, and refuses an `INBOUND_WEBHOOK_SECRET` shorter than 32 bytes; both have tests.
