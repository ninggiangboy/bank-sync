# Bank Sync

Bank Sync turns the transaction emails that Vietnamese banks send into a personal spending ledger.
Users forward their bank emails from Gmail to a personal address; the app checks each email's
DKIM signature, parses it and files the transaction. Older emails are imported by uploading
`.eml` or `.mbox` files.

It is a port of [SpendSync](https://github.com/henrybuidotdev/spendsync) to Bun, Elysia and React.
The port is still in progress: the API, email ingest and parsing work, while the web UI and the
production build are not finished. Progress is tracked in
[the port plan](plans/261125-0632-spendsync-port-elysia-react/plan.md).

## Why forwarding instead of a Gmail connection

SpendSync reads Gmail over IMAP with an app password. Bank Sync never asks for Google credentials:
a Gmail filter forwards bank emails to an unguessable address, Cloudflare Email Routing hands them
to a small Worker, and the Worker posts them to the server. Forwarded mail always fails SPF, so the
bank's DKIM signature is the only proof that an email really came from the bank. An email without a
valid signature still becomes a transaction, but it is marked unverified and counts in no total
until the user confirms it. See [architecture](docs/architecture.md) for the full set of rules.

## Development setup

Requires [Bun](https://bun.sh) 1.4 or newer.

```sh
bun install
cp .env.example .env
bun apps/server/src/cli/index.ts key:generate   # paste both secrets into .env
bun run db:migrate
bun run db:seed            # system categories; add `-- --demo` for the demo account
bun run dev                # API on :8000, Vite on :5173 with /api proxied
```

[`.env.example`](.env.example) documents every setting. Leaving `NODE_ENV` unset means
production, which refuses to start without the URLs, inbound domain and secrets; `bun run dev` and
`bun test` set their own environment.

Receiving real mail also needs a Cloudflare account and the Email Worker in
[`apps/inbound-worker`](apps/inbound-worker/wrangler.toml). In development, emails can be imported
directly with the CLI instead.

## Commands

- Workspace scripts (dev, build, test, typecheck, lint, database): [`package.json`](package.json).
- Server CLI: run `bun apps/server/src/cli/index.ts` without arguments to list its commands
  (reparse stored emails, import `.eml` files, print a user's inbound address, generate secrets and
  more).

Before pushing, `bun run typecheck`, `bun run lint` and `bun test` should all pass.

## Documentation

- [Architecture](docs/architecture.md): workspace layout, how an email becomes a transaction, and
  the decisions behind it.
- [Adding a bank parser](docs/adding-a-bank-parser.md): supporting a new bank.

## License

AGPL-3.0-only, the same as SpendSync. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md) for
upstream credit. A public deployment must offer its source code; set `APP_SOURCE_URL` to the code
it runs.
