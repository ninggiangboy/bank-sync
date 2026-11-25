# Adding a bank parser

Supporting a new bank means teaching the server to read its emails and letting the Email Worker
accept its sender. [`parsing/banks-config.ts`](../apps/server/src/parsing/banks-config.ts) is the
single list of banks; everything below hangs off it.

## 1. Check that the bank signs its mail

Forward a real transaction email from the bank through Gmail and verify its DKIM signature (the
rules are in [architecture](architecture.md#decisions)). If the signature does not survive
forwarding, every forwarded email from that bank arrives unverified and the user has to confirm
each one. Record the sender addresses you saw: only mail from a listed sender is ever stored.

## 2. Write the parser

Add a class in [`apps/server/src/parsing/banks/`](../apps/server/src/parsing/banks) that extends
`AbstractBankParser` from
[`abstract-bank-parser.ts`](../apps/server/src/parsing/abstract-bank-parser.ts). It returns `null`
for mail that is not a transaction, such as OTPs and limit notices.
[`vpbank-parser.ts`](../apps/server/src/parsing/banks/vpbank-parser.ts) is the smallest existing
example. Note in the class comment which real email it was built from.

## 3. Register the bank

- Add the bank to `BANKS` in [`banks-config.ts`](../apps/server/src/parsing/banks-config.ts) with
  its lowercase sender addresses (comment how each was verified), the directions it reports, and
  the parser.
- Add its display name to [`packages/shared/src/banks.ts`](../packages/shared/src/banks.ts), which
  is kept in sync by hand.

## 4. Add fixtures

Put each sample in `apps/server/test/fixtures/emails/<CODE>/` as `NN_name.eml` next to
`NN_name.expected.json`; the folder name must equal the parser's `bankCode()`. A non-transaction
email expects `null`. Remove account numbers, names and balances that are not needed for the test.
[`fixtures.test.ts`](../apps/server/test/parsing/fixtures.test.ts) asserts the fixture count, so
update it.

```sh
bun test apps/server/test/parsing
```

## 5. Update the Email Worker

The Worker's sender allow-list is generated from the bank config. Regenerate it, and redeploy the
Worker so the new sender is not dropped:

```sh
bun run --filter @bank-sync/inbound-worker generate
```

The Worker's `deploy` script regenerates the list on its own, and a Worker test fails while the
generated file is stale.

## Changing an existing parser

Emails already stored keep their old parse until they are parsed again. After a fix, run the CLI's
`reparse` command, optionally limited with `--bank=CODE` or `--failed`
(`bun apps/server/src/cli/index.ts reparse --bank=CODE`).
