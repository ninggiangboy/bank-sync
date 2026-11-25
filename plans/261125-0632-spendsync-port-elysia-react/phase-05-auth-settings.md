---
phase: 5
title: "Auth, profile and user settings"
status: done
priority: P1
effort: "8h"
dependencies: [2]
---

# Phase 5: Auth, profile and user settings

## Goal

Provide the Breeze-equivalent account flows with Better Auth on Elysia, plus profile, password, data deletion, account deletion, and locale/theme settings mirrored in cookies.

## Source references

- `routes/auth.php`, `resources/views/livewire/pages/auth/*.blade.php`, `app/Livewire/Forms/LoginForm.php` (remember me always on, throttled login), `app/Http/Controllers/Auth/VerifyEmailController.php`
- `resources/views/livewire/profile/*.blade.php` (update name, resend verification, update password, delete data, delete account)
- `app/Http/Middleware/ApplyUserSettings.php`, `routes/web.php` (`locale/{locale}`), `app/Models/UserSetting.php`
- `tests/Feature/Auth/*.php`, `tests/Feature/ProfileTest.php`

## Files to Create

- `apps/server/src/auth/auth.ts` (Better Auth: Drizzle SQLite adapter, `emailAndPassword` enabled with `requireEmailVerification: false` as upstream does not gate routes on verification, `sendResetPassword` and `emailVerification.sendVerificationEmail` via the mailer, session cookie long-lived to match "remember me", user `additionalFields.viewingDemo`, built-in rate limiting on sign-in)
- `apps/server/src/auth/plugin.ts` (Elysia plugin: mounts `auth.handler` at `/api/auth/*`, and a `macro`/`derive` `auth: true` that resolves `{ user, session }` or returns 401)
- `apps/server/src/mail/mailer.ts` (nodemailer SMTP; when `MAIL_HOST` is empty, log the email subject and link to the console, matching upstream's `MAIL_MAILER=log` default)
- `apps/server/src/mail/templates/{verify-email,reset-password}.ts` (vi/en subject + body, link to `APP_URL`)
- `apps/server/src/routes/profile.ts`: `PATCH /api/profile` (name ≤255), `POST /api/profile/verification` (resend), `PUT /api/profile/password` (current + new + confirmation), `POST /api/profile/delete-data` (password required), `DELETE /api/profile` (password required)
- `apps/server/src/routes/settings.ts`: `GET/PUT /api/settings` (locale, theme), `PUT /api/locale/:locale` (works signed out: sets the cookie only)
- `apps/server/src/domain/user-data.ts` (`deleteUserData(userId)`: in one transaction force-delete transactions, delete rules, own categories, raw emails, forwarding confirmations, and inbound addresses; login kept. The user lands on `/connect` and gets a fresh address, so a Gmail filter still pointing at the old one stops delivering)
- `apps/server/test/auth/*.test.ts`

## Behavior to preserve

- Register: name, lowercase email unique, password per Laravel `Password::defaults()` (min 8). Signs in immediately and lands on `/transactions`; sends the verification email.
- Login: always remembered; wrong credentials return a generic `auth.failed` error; throttled after 5 attempts per email+IP (Better Auth rate limit config).
- Forgot / reset password, verify email link, resend verification from profile.
- Delete data and delete account both require the current password. Delete account cascades through FKs and signs out.
- Signing out clears `viewingDemo`.
- Settings: locale `vi|en` (default `vi`), theme `light|dark|system` (default `system`). Signed-in values are saved and mirrored to `locale` and `theme` cookies (1 year); signed-out pages read the cookies. `GET /api/settings` returns the effective values for signed-out users too.
- Error contract: validation errors as `{ error: { code: 'validation', fields: { name: ['required'] } } }` with codes the client translates.

## Verification

- `bun test apps/server/test/auth` covers: register, login success/failure/throttle, logout clears demo flag, reset flow with a captured email, verification link, profile update, password update with wrong current password, delete data keeps the user and removes all owned rows, delete account removes everything by cascade.

## Risks

- Better Auth API shape changes between minors. Mitigation: pin the version and read its current docs (Elysia integration, Drizzle adapter, `additionalFields`, `deleteUser`) at implementation time.
- Password policy differs from Laravel defaults. Mitigation: set min length 8 explicitly and test it.
- Dev origin mismatch. The SPA runs on `http://localhost:5173` and proxies `/api`, but `.env.example` sets `APP_URL=http://localhost:8000`. Better Auth's origin check will reject browser POSTs, and email links will point at a port with no SPA. Set `trustedOrigins` for the Vite origin in development, or make the dev `APP_URL` the Vite origin.
- Regenerate the auth tables with `NODE_ENV=development bunx --bun auth@<pinned> generate --config apps/server/src/auth/auth.ts --output apps/server/src/db/auth-schema.ts --yes`, then `bun run db:generate`. `--bun` is needed because the config imports `bun:sqlite`.

## Handover notes (implementation)

- `createApp({ db, files, mailer })` builds Better Auth itself (`auth/create-auth.ts`); `auth/auth.ts` exports a separate instance only for `auth generate`. Routes declare `{ auth: true }` and receive `{ user, session }`; demo-owned accounts get `403 demo_read_only` on every profile mutation.
- Auth endpoints keep Better Auth's own error bodies (`{ code, message }`, e.g. `INVALID_EMAIL_OR_PASSWORD` for both a wrong password and an unknown email). Our routes use `{ error: { code, fields } }` with field codes `required`, `max`, `min`, `confirmed`, `current_password`, `invalid`. Login throttle: `429 { error: { code: "auth.throttle", seconds } }` after 5 failures per email and socket address per minute (`cache` table); Better Auth's 3-per-10-seconds sign-in rule is switched off, its limiter is off under test, and the origin check is enabled explicitly so tests cover it.
- Password reset: `POST /api/auth/request-password-reset { email, redirectTo }` then `POST /api/auth/reset-password { newPassword, token }`; the emailed link goes through `/api/auth/reset-password/<token>?callbackURL=…`. Verification: `GET /api/auth/verify-email?token&callbackURL`.
- Set `APP_URL` to the Vite origin in development (see `.env.example`); `trustedOrigins` also lists `http://localhost:5173` when `NODE_ENV=development`.
- The `locale` and `theme` cookies are not `HttpOnly` so the first paint can read them.
