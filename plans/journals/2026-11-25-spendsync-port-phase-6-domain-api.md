---
title: "SpendSync port phase 6: domain API"
date: 2026-11-25
summary: "Typed endpoints for transactions, reports, settings, forwarding, imports and demo landed with isolation and demo read-only tests; the demo ledger generator is unverified against PHP."
---

# SpendSync port phase 6: domain API

## What happened

Phase 6 of `plans/261125-0632-spendsync-port-elysia-react` landed on `feat/spendsync-port` (319 tests, typecheck and lint green). Every endpoint in the phase table exists, plus the demo seed (`bun run db:seed -- --demo`).

- Reads resolve an owner (the demo account while the user views it); writes go through `writeContext`, which refuses demo-owned data before rate limits and validation. A test walks every registered mutating route, so a new unguarded route fails it.
- The demo ledger uses a TypeScript port of PHP's Mt19937 and `getInt`. It matches the reference MT19937 vector, but PHP was not available to compare the generated ledger.
- An independent review found, and these were fixed: `GET /forwarding` and `filter.xml` created an address for the demo account; the server body limit equalled the handler's upload limit, so oversize uploads got a bare 413; report change rounding differed from PHP; huge manual amounts lost precision; the demo refresh missed a mixed-case demo email.

## Decisions

- While viewing demo, all mutating routes return `demo_read_only`, including the viewer's own category, rule and address changes (the phase file's rule; upstream is looser).
- Upstream has 20 `.eml` fixtures, not 28, so the demo gets about 15 fixture transactions.

## Next steps

Phase 7 (frontend shell). `docs/testing.md` does not exist yet; list the dropped IMAP connect and sync cases there in phase 9 or 10. The demo account can still save its own appearance settings and `POST /api/demo` writes its own row; both are harmless but upstream refuses them.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
