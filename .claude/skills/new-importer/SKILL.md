---
name: new-importer
description: Add or change a NestVault statement importer (bank or broker file → transactions or investment operations) — a Python code parser or a declarative import spec in the parser service, detection/confidence, the import pipeline, or AI-generated specs. Covers BPI xlsx, XTB xlsx, Trade Republic PDF, Banco Invest xlsx, generic bank CSV, investment-transactions CSV, or a new bank. Use it whenever the user mentions importing a statement/extrato, a new bank or broker, a file format, automatic format detection, parsing xlsx/pdf/csv, duplicates on re-import, or porting the Python scripts in docs/tools, even if they don't say "importer".
---

# New importer

Importers turn a file the user downloads from a bank into rows in the app. They must be
**idempotent** (re-importing never duplicates), **safe** (the file is untrusted input), and
**previewable** (nothing is written until the user confirms). The prototype
(`docs/prototype/cofre-familiar-v28.html`: `parseCSV`, `guessMap`, `importRows`, `hashRows`,
`xtbParse`, `xtbBuild`, `inferDividend`) and the Python scripts in `docs/tools/` are the reference
behaviour — port them, don't reinvent them.

## Architecture (read `docs/adr/0001-ai-assisted-importers.md`)

All parsing lives in the **parser service** `services/parser` (Python, FastAPI, `pdfplumber`,
`openpyxl`), an isolated container: no DB access, no outbound network, resource limits, non-root,
read-only filesystem. Two kinds of parser share one interface:

```python
class Parser(Protocol):
    id: str            # "trade-republic-pdf", "bpi-xlsx", or a spec id
    kind: Literal["bank", "broker"]   # bank → transactions, broker → investment_ops
    version: int
    def detect(self, f: SniffedFile) -> float: ...   # confidence 0..1, cheap (fingerprint only)
    def parse(self, f: SniffedFile) -> ParseResult: ... # pure: no DB, no network
# ParseResult = { rows, warnings, meta: { account_hint?, period?, opening_balance?, closing_balance? } }
```

- **Code parser** (`services/parser/parsers/<id>.py`): hand-written Python for formats a spec
  cannot express (most PDFs, multi-sheet broker files). Only added through a reviewed PR.
- **Spec parser** (`services/parser/specs/<id>.json`, later also the `import_specs` table): a
  declarative JSON run by the spec engine (`services/parser/engine/`). Prefer a spec whenever the
  format is a table (CSV/xlsx) — it needs no new code.

Pipeline (Node, `packages/services/src/imports`): upload → validate and store encrypted → parser
service `/detect` (highest confidence above the threshold wins; ask the user on ties/low scores) →
`/parse` (in the worker when > 1 MB) → validate rows with zod → dedup/hash → **preview** (+ category
rules) → user confirms → **commit** in one `withPool` transaction → `deposits.link` job. Store
`parser_id`, `parser_kind`, `parser_version`, `confidence`, `reconciled` on the import batch.

## Adding a format

1. Get an anonymized sample (see Tests). Decide spec vs code: a single table → spec; otherwise code.
2. Write the `fingerprint` / `detect` so it scores high on this format and near zero on every other
   fixture (the detection test runs all parsers against all fixtures).
3. Write the spec or parser, then the fixture test and the reconciliation check.
4. Porting `docs/tools/*.py`: move the logic into a code parser class; keep its behaviour and
   output fields; drop the CSV writing (the service returns JSON rows).

## AI-generated specs (phase 5)

The AI never writes code that runs. It receives only synthesized structure (headers, layout, fake
sample rows) and returns a spec constrained to the spec JSON schema. The spec is validated on the
real file inside the parser service (schema, every row parses, balance reconciliation, row count),
then previewed by the user. Promotion: `draft` (creating pool only) → `verified` (3 reconciled,
confirmed imports or admin approval) → `global`. Failing global specs are demoted automatically.

## Rules

1. **Idempotency.** Each row gets a stable key:
   - external id when the source has one (XTB operation id) → `ext_id`;
   - otherwise the prototype hash: `account + date + normalized description + amount + '#' + n`,
     where `n` counts identical rows inside the same file (two real identical coffees stay two).
   - The file's SHA-256 is stored in `import_batches`; the same file again is reported as already
     imported. Unique index `(pool_id, account_id, hash)`.
2. **Numbers.** Use the shared `parse_num` (port of the prototype's `parseNum`; handles `1.234,56`,
   `1,234.56`, `(12,00)`, trailing `-`, `€`). Return decimals as strings (`Decimal`); never floats.
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

- pytest in `services/parser/tests/`. Fixture in `services/parser/fixtures/<format>/` — **anonymized** (fake names, IBANs and
  descriptions; keep structure, dates and amounts realistic). Use the `xlsx`/`pdf` skills to
  build them from a real file the user provides; never commit a real statement.
- Expected output JSON next to the fixture; the test compares `parse()` against it.
- Reference values from `docs/handoff.md` where they apply (XTB account: cash 11.25 USD, gross
  dividends 70.75 USD, tax −10.69 USD, refund +4.24 USD, deposits 1284.39 USD; BPI balance
  3959.43 €; Trade Republic 5285.98 €; Banco Invest per-holder units/values).
- Re-import of the same fixture → 0 new rows.
- `detect` returns false for the other formats' fixtures.
- Malformed / oversized / renamed-binary files are rejected with a clear error.
- **Reconciliation:** when the format has a balance column, opening balance + Σ movements equals
  every running balance and the closing balance.
- **Detection matrix:** every parser against every fixture — only the right one scores above the
  threshold.
- For specs: the spec validates against the spec JSON schema.

Then run `finish-task`.
