---
phase: 3
title: "Parsing engine with fixture parity"
status: done
priority: P1
effort: "8h"
dependencies: [1]
---

# Phase 3: Parsing engine with fixture parity

## Goal

Port the bank email parsing layer to pure TypeScript so that every upstream `.eml` fixture produces exactly its `expected.json`.

## Source references (read fully before writing code)

- `.upstream/spendsync/app/Parsing/**` (interface, DTOs, registry, Support helpers, three bank parsers)
- `config/banks.php` (codes, names, senders, directions)
- `app/Mail/Inbox/FetchedMessage.php` (`fromEml`: message id fallback `sha1-…`, lowercase from, subject trim, html/text bodies, date)
- `tests/Unit/BankParserFixturesTest.php`, `tests/Unit/ParsingSupportTest.php`, `tests/Feature/BalanceRedactorTest.php`
- `tests/Fixtures/emails/{VCB,CAKE,VPB}/*.eml` + `*.expected.json` (28 files)

## Files to Create

- `apps/server/src/parsing/text-normalizer.ts` (`nfc`, `htmlToText`, `clean`, `fold`)
- `apps/server/src/parsing/money-parser.ts` (`parse`, `parseWithCurrency`)
- `apps/server/src/parsing/date-parser.ts` (returns a UTC instant for a wall time in `Asia/Ho_Chi_Minh`)
- `apps/server/src/parsing/balance-redactor.ts`
- `apps/server/src/parsing/exchange-rates.ts` (reads `storage/fx-rates.json`, falls back to `FX_USD_VND`)
- `apps/server/src/parsing/abstract-bank-parser.ts`, `apps/server/src/parsing/banks/{vietcombank,cake,vpbank}-parser.ts`
- `apps/server/src/parsing/banks-config.ts` (codes, names, senders, directions, parser), `apps/server/src/parsing/parser-registry.ts`
- `apps/server/src/parsing/types.ts` (`ParsedEmailInput`, `ParsedTransaction`, `UnparseableEmailError`)
- `apps/server/src/mail/fetched-message.ts` (`fromEml(raw)` via mailparser `simpleParser`)
- `apps/server/test/fixtures/emails/**` (copy all 28 fixture files unchanged)
- `apps/server/test/parsing/*.test.ts`
- `packages/shared/src/banks.ts` (code → display name, used by the UI)

## Translation rules (PCRE → JS)

- Use the `u` flag everywhere the PHP pattern has `/u`. Keep `m`/`i`/`s` as in PHP.
- PHP `/x` (extended) patterns, e.g. `BalanceRedactor`: rewrite as a single-line pattern or build from an array of parts; escaped spaces (`\ `) become literal spaces.
- `\b` in JS is ASCII-only even with `u`. Upstream applies `\b` only to folded (ASCII) text, so keep it there; anywhere it touches Vietnamese letters, use lookarounds `(?<![\p{L}\d])` / `(?![\p{L}\d])`.
- `preg_match` returns the first match: use `str.match(re)` without `g`. `preg_replace` replaces all: use `g`.
- `html_entity_decode(..., ENT_QUOTES|ENT_HTML5)`: use the `entities` package (`decodeHTML`) or `he`; named entities like `&nbsp;` must become U+00A0 before `clean()` collapses them.
- `Normalizer::FORM_C/D` → `String.prototype.normalize('NFC'|'NFD')`; `\p{Mn}` works with `u`.
- `mb_strtolower` → `toLowerCase()`; `ctype_digit` → `/^\d+$/`.
- `MoneyParser` rounding: half-up on the 2-digit fraction; foreign amounts in minor units (×100), JPY/KRW caveat preserved and documented.
- `DateParser`: build the wall time with `Temporal` if available in Bun at implementation time, otherwise with a small helper that converts a wall time in a fixed IANA zone to UTC via `Intl.DateTimeFormat` offset lookup. Vietnam has no DST, but do not hardcode +07:00; the timezone comes from env.
- `occurred_at` in `expected.json` is ISO 8601 with `+07:00`; serialize the test output in the display timezone to compare.

## Tasks & Steps

1. Port Support helpers first with their unit tests from `ParsingSupportTest.php` and `BalanceRedactorTest.php` (same inputs, same outputs).
2. Port `AbstractBankParser` (`field`, `blockField`, `isNonTransaction`, `transaction`, `toVnd`, `directionFromSign`, `directionFromKeywords`, account number and clean rules) and the three bank parsers line by line.
3. Implement `fromEml` with mailparser. Check that mailparser's `html` and `text` match what webklex produced closely enough for parsers; the fixture test is the judge.
4. Write the data-driven fixture test: for each `{BANK}/*.eml`, parse and deep-compare with `*.expected.json` (`null` = not a transaction). Also assert each bank folder has at least 3 transaction fixtures and 1 non-transaction fixture, as upstream does.
5. Error contract: `UnparseableEmailError` codes `amount_missing`, `direction_unknown`, `currency_unsupported`; other exceptions map to `parser_error: <ClassName>`.

## Verification

- `bun test apps/server/test/parsing` passes with all 28 fixtures green and all ported Support tests green.

## Risks

- Highest fidelity risk in the port. A wrong regex silently misparses amounts or direction. Mitigation: do not move on to phase 4 until the fixture test is fully green; never edit an `expected.json` to make a test pass. If a fixture disagrees because of MIME decoding differences, fix `fromEml`, not the parser or the fixture.

## Handover notes (implementation)

- The plan said 28 fixtures; upstream has 20 `.eml` files (each with an `.expected.json`). All 20 pass.
- mailparser invents a wrapped `text` for HTML-only mail, which defeated balance redaction; `fromEml` keeps `text` only when the raw message has a real `text/plain` part.
- Dates are plain `Date` instants; `date-parser.ts` converts wall time with `Intl` (no Temporal types in TS 7 lib) and exports `toIsoInZone`. `STORAGE_PATH` (default `storage`) holds `fx-rates.json`.
