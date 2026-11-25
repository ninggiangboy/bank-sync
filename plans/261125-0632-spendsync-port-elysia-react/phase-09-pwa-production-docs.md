---
phase: 9
title: "PWA, production build and docs"
status: pending
priority: P2
effort: "4h"
dependencies: [8]
---

# Phase 9: PWA, production build and docs

## Goal

Make the app installable, serve API and SPA from one Bun process in production, and document setup, operation and licensing.

## Source references

- `public/sw.js`, `public/manifest.webmanifest`, `public/{icon.svg,apple-touch-icon.png,favicon.ico,og-image.png,robots.txt}`
- `resources/views/partials/{head,sa}.blade.php` (meta, Simple Analytics toggle)
- `README.md` (setup, worker/scheduler, Gmail steps, commands, how it works, adding a bank parser, security and privacy, known limits, license). The Gmail app password and IMAP sections are replaced by forwarding; see the [advise report](../reports/advise-261125-1347-gmail-forwarding-ingest.md)

## Files to Create / Modify

- `apps/web/public/sw.js` (cache-first for `/assets/*` only, versioned cache name `bank-sync-static-v1`, delete old caches on activate; pages and API always from network)
- `apps/web/public/manifest.webmanifest` (name and short name "Bank Sync", `lang: vi`, `start_url: /transactions`, standalone, theme colors), icons copied from upstream (generic icons; replace the wordmark if the icon contains the SpendSync name)
- `apps/web/index.html` (meta description, Open Graph tags, theme-color for light and dark, manifest, icons, fonts, pre-paint theme script, conditional Simple Analytics script injected by the server when enabled)
- `apps/server/src/static.ts` (production: serve `apps/web/dist` with `@elysiajs/static`, long cache for `/assets/*`, SPA fallback to `index.html` for non-`/api` GET routes)
- `apps/server/src/index.ts` (start worker and scheduler when `WORKER_ENABLED` / `SCHEDULER_ENABLED`; graceful shutdown)
- `README.md`, `docs/architecture.md`, `docs/adding-a-bank-parser.md`, `docs/cloudflare-email-routing.md`
- `apps/inbound-worker/wrangler.toml` (production values: `INBOUND_URL`, secret `INBOUND_WEBHOOK_SECRET` set with `wrangler secret put`), deploy script `bun run --filter inbound-worker deploy`

## Tasks & Steps

1. Register the service worker from `main.tsx` on load (production only).
2. Production scripts: `bun run build` builds web then type-checks server; `bun run start` runs migrations, then serves on `PORT`.
3. `docs/cloudflare-email-routing.md`: put the domain on Cloudflare DNS, enable Email Routing for `INBOUND_DOMAIN` (subdomain, or a dedicated domain if subdomains are not supported), add a catch-all rule that sends to the Worker, deploy the Worker, set the shared secret on both sides, and an end-to-end check (send a test email to an address from `bun run cli inbound-address <user>` and watch it arrive). Include what happens when the server is down, based on the behavior confirmed in phase 4.
4. README (Vietnamese, like upstream) covering: stack, requirements (Bun ≥1.4, a Cloudflare account for receiving mail), setup (`bun install`, `.env`, `bun run cli key:generate`, `bun run db:migrate`, `bun run db:seed`), demo without any email setup, worker and scheduler (in-process, toggles, single-instance note), connecting a bank email via forwarding (user steps, DKIM and unverified transactions, importing history with Takeout), CLI table, tests, how it works (new diagram: Gmail filter → Cloudflare → Worker → inbound endpoint → queue → parser), security and privacy (no Google credentials stored, HMAC webhook, DKIM, non-bank mail discarded, Worker stores nothing), known limits (upstream list minus the IMAP ones, plus: new mail only unless imported, Workspace orgs may block forwarding, banks without DKIM need manual confirmation, the filter can break silently, watch "last received"), license AGPL-3.0 and upstream credit.
5. `docs/adding-a-bank-parser.md`: banks config entry (the Worker's sender allow-list is generated from it, so redeploy the Worker), parser class, fixtures with `expected.json`, run the fixture test, reparse command, and check that the bank DKIM-signs with a forwarded sample.

## Verification

- `bun run build && bun run start`, then: `/` loads, deep link `/transactions?month=2026-11` loads directly, `/api/up` is 200, Lighthouse "installable" passes, service worker caches only `/assets/*`.
- Every command in the README runs as written on a clean clone.
- With the Worker deployed: a real bank email forwarded from Gmail appears as a transaction in under 60 seconds; a plain email sent to the same address from a personal account is not stored.

## Risks

- SPA fallback swallowing API 404s. Mitigation: fallback only for GET requests whose path does not start with `/api`; test it.
