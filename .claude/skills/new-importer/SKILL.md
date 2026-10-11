---
name: new-importer
description: Add or change a NestVault statement importer (bank or broker file → transactions or investment operations) — BPI xlsx, XTB xlsx, Trade Republic PDF, Banco Invest xlsx, generic bank CSV, investment-transactions CSV, or a new bank. Use it whenever the user mentions importing a statement/extrato, a new bank or broker, a file format, parsing xlsx/pdf/csv into the app, duplicates on re-import, or porting the Python scripts in docs/tools, even if they don't say "importer".
---

# New importer

Importers turn a file the user downloads from a bank into rows in the app. They must be
**idempotent** (re-importing never duplicates), **safe** (the file is untrusted input), and
**previewable** (nothing is written until the user confirms). The prototype
(`docs/prototype/cofre-familiar-v28.html`: `parseCSV`, `guessMap`, `importRows`, `hashRows`,
`xtbParse`, `xtbBuild`, `inferDividend`) and the Python scripts in `docs/tools/` are the reference
behaviour — port them, don't reinvent them.

## Interface (`packages/importers/src/<format>/index.ts`)

```ts
export const bpiXlsx: Importer<BankRow> = {
  id: 'bpi-xlsx',
  kind: 'bank',                                   // 'bank' → transactions, 'broker' → investment_ops
  detect(file: SniffedFile): boolean,             // cheap check on headers / magic bytes
  parse(file: SniffedFile): ParseResult<BankRow>, // pure: no DB, no network
};
// ParseResult = { rows, warnings, meta: { accountHint?, period?, closingBalance? } }
```

Pipeline (in `packages/services/src/imports`): upload → validate file → `detect` → `parse`
(in the worker when > 1 MB) → **preview** (dedup against existing rows + apply category rules) →
user confirms → **commit** in one `withPool` transaction → `deposits.link` job.

## Rules

1. **Idempotency.** Each row gets a stable key:
   - external id when the source has one (XTB operation id) → `ext_id`;
   - otherwise the prototype hash: `account + date + normalized description + amount + '#' + n`,
     where `n` counts identical rows inside the same file (two real identical coffees stay two).
   - The file's SHA-256 is stored in `import_batches`; the same file again is reported as already
     imported. Unique index `(pool_id, account_id, hash)`.
2. **Numbers.** Use the ported `parseNum` (handles `1.234,56`, `1,234.56`, `(12,00)`, trailing `-`,
   `€`). Return decimals as strings; never floats.
3. **Dates.** Output ISO `yyyy-mm-dd`; accept `dd-mm-yyyy`, `dd/mm/yyyy`, Excel serials.
4. **Sign.** Positive = money in, negative = money out.
5. **Opening balance.** When the file has a balance column, use the newest row's balance to
   reconcile the account (as the prototype does).
6. **Broker specifics (XTB):** dividends grouped by symbol and date with withholding tax and tax
   refunds kept separate; cash operations + open positions sheets.
7. **Banco Invest:** each lot per holder → a buy on the holder's sub-account.

## Security (docs/security.md §14, §16)

- Max 10 MB; detect type by content (xlsx = zip `PK\x03\x04`, pdf = `%PDF`, csv = valid UTF-8/Latin-1
  text), not by extension.
- xlsx: limit entries and total uncompressed size (zip-bomb guard); never evaluate formulas or
  macros — read cached values only.
- CSV: guard against formula injection when **exporting** (`=`, `+`, `-`, `@` prefixes).
- Validate every parsed row with zod before preview.
- Store the original encrypted, named by SHA-256; never log row contents (amounts, IBANs).

## Tests (required)

- Fixture in `packages/importers/fixtures/<format>/` — **anonymized** (fake names, IBANs and
  descriptions; keep structure, dates and amounts realistic). Use the `xlsx`/`pdf` skills to
  build them from a real file the user provides; never commit a real statement.
- Expected output JSON next to the fixture; the test compares `parse()` against it.
- Reference values from `docs/handoff.md` where they apply (XTB account: cash 11.25 USD, gross
  dividends 70.75 USD, tax −10.69 USD, refund +4.24 USD, deposits 1284.39 USD; BPI balance
  3959.43 €; Trade Republic 5285.98 €; Banco Invest per-holder units/values).
- Re-import of the same fixture → 0 new rows.
- `detect` returns false for the other formats' fixtures.
- Malformed / oversized / renamed-binary files are rejected with a clear error.

Then run `finish-task`.
