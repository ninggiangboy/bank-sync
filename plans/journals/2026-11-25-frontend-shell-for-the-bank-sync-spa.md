---
title: Frontend shell for the Bank Sync SPA
date: 2026-11-25
summary: "Phase 7 shell landed: Tailwind 4 palette remap, i18n port, layouts, shared components; pages deferred to phase 8"
---

# Frontend shell for the Bank Sync SPA

## What happened

Phase 7 of `plans/261125-0632-spendsync-port-elysia-react` is implemented in `apps/web`. The run started as phases 7 and 8; the user narrowed it to phase 7 only partway through, so no page routes were built.

- Design system: `src/styles/app.css` remaps the Tailwind color names the source markup uses (slate/gray, emerald/green, amber/yellow, sky/blue, red, white, black, chart-1..8) through `@theme inline` onto `--c-*` variables that switch with `data-theme` and the system preference. The built CSS confirmed `text-emerald-700` reads `var(--c-brand-700)`, all `shadow-*` are 1px hairlines and radii are squared.
- i18n: all 299 upstream `vi.json` keys ported with `{{name}}` placeholders and SpendSync renamed, plus Laravel auth/password/validation lines and server error codes. English falls back to the key.
- Shell: query client with global `demo_read_only` notice and session-end redirect, Eden `unwrap` and Better Auth `authCall` normalizing to `ApiError`, toasts, keyboard handoff for `data-keyboard` links, zod search schemas, and the shared components (CategoryPicker, EmojiPicker, Modal on native `<dialog>`, MonthSwitcher, Navigation, …).
- Server: `GET /api/public/config` now includes `timeZone` so dates render in `APP_TIMEZONE`.

## Problems found

- TanStack Router rejects pathless layout routes (`_app`, `_guest`) that have no children yet: both resolve to `/` and the generator errors, while `vite build` still reports success. Layouts moved to `src/layouts/`; phase 8 adds the route files with their first child page.
- Better Auth answers a wrong password with 401, so a global "401 means signed out" handler would bounce the login page to itself. The handler now reacts only to the API's `401 unauthenticated`.
- Typed `<Link to>` only accepts existing routes, so shared components link through a small `AppLink` until the pages exist.

## Verification

`bun run --filter web typecheck`, `vite build`, `bun run lint` and `bun test` (319 pass) are green. A browser smoke run against Vite + API confirmed light/vi by default and a dark/en first paint from the cookies, with no page errors.

## Next steps

Phase 8 pages. Changes are not committed yet.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
