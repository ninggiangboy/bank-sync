---
phase: 5
title: "Auth, profile and user settings"
status: pending
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
