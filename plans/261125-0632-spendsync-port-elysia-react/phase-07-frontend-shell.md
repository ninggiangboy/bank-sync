---
phase: 7
title: "Frontend shell"
status: pending
priority: P1
effort: "8h"
dependencies: [1]
---

# Phase 7: Frontend shell

## Goal

Build the React SPA foundation: routing with typed search params, data fetching against the Eden client, the ported design system in Tailwind 4 (light and dark), vi/en translations, layouts and shared components.

## Source references

- `tailwind.config.js` (palette remap, dark mirroring, chart colors, hairline shadows, square radii, fonts), `resources/css/app.css` (tabs, segmented control, typing dots)
- `resources/views/partials/head.blade.php` (pre-paint theme script, fonts, meta, manifest), `resources/views/layouts/{app,guest}.blade.php`, `resources/views/livewire/layout/navigation.blade.php`
- `resources/views/components/*.blade.php` (amount, category icon/picker, emoji picker, modal, dropdown, flash, month switcher, inputs, buttons, supported banks, auth tabs)
- `lang/vi.json`, `lang/{vi,en}/{auth,passwords,validation}.php`
- `resources/js/app.js` (keyboard focus trick on navigation, refetch after history restore, autofocus after navigation)

## Files to Create

- `apps/web/src/lib/api.ts` (Eden Treaty client typed from `type App`, `credentials: 'include'`, error normalizer to `{ code, fields }`)
- `apps/web/src/lib/auth-client.ts` (Better Auth React client)
- `apps/web/src/lib/query-client.ts`, `apps/web/src/lib/format.ts` (money `1.250.000 ₫` with `−`/`+`, foreign `12,50 USD`, local dates in `APP_TIMEZONE` via `Intl`, month helpers)
- `apps/web/src/routes/__root.tsx`, `apps/web/src/routes/_app.tsx` (auth guard → `/login`; demo banner; read-only toast; bottom navigation), `apps/web/src/routes/_guest.tsx`
- `apps/web/src/styles/app.css` (Tailwind 4: `@import "tailwindcss"`, `@plugin "@tailwindcss/forms"`, `@custom-variant dark` keyed on `[data-theme=dark]` and system preference, `@theme` tokens that remap `slate/gray → neutral`, `emerald/green → brand`, `amber/yellow → yellow`, `sky/blue → blue`, `red`, `chart-1..8`, `white → paper`, `black → ink` as CSS variables switched per theme exactly as the source's `cssVars('light'|'dark')`; hairline `shadow-*`; radii; fonts Be Vietnam Pro and IBM Plex Mono; `.tabs`, `.tab`, `.segmented`, `.segment`, `.typing-dots`)
- `apps/web/src/i18n/{index.ts,vi.json,en.json}` (all 301 `vi.json` keys ported; English keys are the source strings; plus validation, auth and password messages; server error codes map to keys; `:count` placeholders become `{{count}}`)
- `apps/web/src/components/*` (Amount, CategoryIcon, CategoryPicker, EmojiPicker, Modal, Dropdown, Flash/Toast, MonthSwitcher, TextInput, PasswordInput, InputError, Buttons, SupportedBanks, AuthTabs, Navigation)
- `apps/web/src/lib/theme.ts` (applies `data-theme` from settings or cookie; `index.html` carries a tiny inline script that reads the `theme` cookie before paint so there is no flash)

## Tasks & Steps

1. Set up TanStack Router (file routes via the Vite plugin) and Query; search param schemas with zod for `month` (`YYYY-MM`), `filter`, `category`, `payee`, so back/forward and shared links keep state as `#[Url]` did.
2. Port the palette and the dark-mode mirroring rule (`mirror(scale)` → explicit dark values) into CSS variables; keep the class names the source views use so page markup ports with minimal edits.
3. Port translations. Default `vi`, fallback `en`. Language comes from settings (signed in) or the `locale` cookie; `<html lang>` follows it.
4. Port components with the same accessibility attributes (`role="status"`, `aria-pressed`, `aria-current`, `min-h-11` tap targets, focus rings).
5. Port the app.js behaviors: autofocus the `[autofocus]` field after route change; open the mobile keyboard for links marked `data-keyboard` by focusing a hidden input during the tap; refetch active queries when a page is restored from history.
6. Global handling of `403 demo_read_only`: show the read-only toast for 8 s with an "Exit demo mode" button.

## Verification

- `bun run --filter web typecheck && bun run --filter web build` pass.
- Vitest-free smoke: a Playwright check (phase 10) loads the shell in light and dark and in vi and en.
- Visual check against upstream screenshots taken from a local upstream run is optional; the class names and tokens are the contract.

## Risks

- Tailwind 4 drops the JS config; the remap must be done with `@theme` variables. Mitigation: keep one token file and verify a few representative classes (`bg-slate-50`, `text-emerald-700`, `ring-amber-200`) resolve to the source hex values in both themes.
