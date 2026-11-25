---
phase: 8
title: "Frontend pages"
status: pending
priority: P1
effort: "16h"
dependencies: [6, 7]
---

# Phase 8: Frontend pages

## Goal

Port every screen of the source to React pages on the phase 6 API, matching layout, copy, states and interactions.

## Source references

Each page below lists its Livewire class and Blade view under `.upstream/spendsync/`. Read both before building the page; the Blade view is the markup contract and the class is the behavior contract.

## Pages

| Route | Source | Notes |
| --- | --- | --- |
| `/` | `resources/views/home.blade.php`, deck script in `resources/js/app.js` | Landing page with supported banks, example card deck (click or button sends top card to back; respects reduced motion), privacy summary rewritten for forwarding ("no Gmail password, you forward only bank emails"), how-it-works steps updated, source link, "Bank Sync" branding |
| `/login`, `/register`, `/forgot-password`, `/reset-password/:token`, `/verify-email` | `livewire/pages/auth/*`, `layouts/guest` | Guest layout, auth tabs, errors from codes |
| `/connect` | New screen (layout style from `livewire/connect-gmail.blade.php`; behavior from `GET /forwarding`) | Step list: (1) personal address with copy button and "add it in Gmail → Settings → Forwarding and POP/IMAP" (deep link to Gmail settings); (2) Gmail confirmation code and "open confirmation link" button that appear by themselves when the confirmation email arrives (poll `GET /forwarding` every 3 s while this step is open, stop after 10 min); (3) create the filter: copy the `from:(…)` query, or download `filter.xml` with import steps, and a note to tick "Also apply to matching conversations" so old emails get a label for step 4; (4) import old emails: Google Takeout of that label, then upload the `.mbox` (or `.eml` files) with a progress state and the result counts. Also: last received email per bank, "get a new address" with a confirm dialog explaining the filter must be updated, a short note that Gmail shows a "forwarding is on" banner for a few days, and a note that some Google Workspace organizations block forwarding |
| `/transactions` | `livewire/transactions/index.blade.php`, `Index.php` | Month switcher, spent/income totals, filter tabs, category or payee scope chip with clear, day groups, hidden rows dimmed, unverified rows with an "unverified" badge and a banner "N transactions need confirmation" when `unverifiedCount > 0`, a "waiting for your first bank email" state with a link to `/connect` when forwarding is set up but nothing has arrived, empty states incl. "jump to latest month with data", "view demo data" for users without transactions, add button. The upstream sync banner is gone |
| `/transactions/:id` | `livewire/transactions/show.blade.php`, `Show.php` | Unverified notice ("we couldn't confirm this email came from the bank") with a "Confirm it's real" button; source line (forwarded and verified by `dkimDomain`, imported from file, or manual); category picker (fitting), "apply to future" toggle with rule target text, "apply to N uncategorized", note autosave (debounced, "saved" indicator), hide/show with explanation, delete for manual, raw email text toggle (escaped `<pre>`), back link keeps `filter`/`category`/`payee` |
| `/transactions/create`, `/transactions/:id/edit` | `livewire/transactions/form.blade.php`, `Form.php` | Direction toggle clears a category that no longer fits, amount input with dot grouping, datetime-local in local time, counterparty, category picker (tap again to clear), note |
| `/reports` | `livewire/reports.blade.php`, `Reports.php` | Month switcher, total and change vs comparison period text, category bars in the 8 chart colors (`id % 8 + 1`), tap a category → transactions scoped to it, top counterparties → payee scope |
| `/settings`, `/settings/:section` (`forwarding`, `categories`, `rules`, `appearance`) | `livewire/settings.blade.php`, `Settings.php` | Menu with counts; forwarding section shows the address, last received per bank, and links to `/connect` for setup, import and new address (replaces the upstream Gmail status, sync now and disconnect); categories by type tabs with add (name, emoji, parent), inline rename, delete, transaction counts; rules list with delete; appearance segmented controls for language and theme; logout; source link |
| `/profile` | `profile.blade.php`, `livewire/profile/*` | Name, resend verification, password change, delete data (password), delete account (password) in modals |
| `/privacy`, `/terms` | `privacy/{vi,en}`, `terms/{vi,en}`, `components/privacy-layout` | Rendered per current locale; rename SpendSync → Bank Sync and add the upstream credit line. Rewrite the data-collection parts for forwarding: the app never asks for or stores Google credentials; it only receives emails the user forwards; non-bank emails are discarded unread; forwarded mail passes through Cloudflare Email Routing; how to stop (remove the Gmail filter or get a new address) and how to delete data |
| `*` | `errors/minimal.blade.php` | 404 page |

## Files to Create

- `apps/web/src/routes/**` (one file per route above) and page-local components under `apps/web/src/features/{transactions,reports,settings,auth,profile,connect,home,legal}/`
- `apps/web/src/features/legal/content/{privacy,terms}.{vi,en}.tsx`

## Tasks & Steps

1. Build pages in this order so each one is usable end to end: auth → connect → transactions list → detail → form → reports → settings → profile → home → legal → 404.
2. Use query keys per resource and invalidate on mutation (category change updates list, reports and settings counts), replacing Livewire's re-render.
3. Toasts replace `session()->flash('status')` messages with the same copy, including the "Manage rules" link after saving a rule.
4. Keep mobile-first layout (`max-w-lg` container, bottom nav, sticky header, safe-area insets).

## Verification

- `bun run --filter web typecheck && bun run --filter web build` pass.
- Manual run with the demo seed: walk every row of the table in vi and en, light and dark, phone width (375 px) and desktop.
- Phase 10 Playwright specs cover the critical flows.

## Risks

- Behavior that Livewire gave for free (optimistic re-render, URL sync, history cache) can regress. Mitigation: search params are router state; all mutations invalidate the affected queries; Playwright covers back/forward after changing a category.
