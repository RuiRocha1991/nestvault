# Parser service

Isolated Python service that detects and parses bank and broker statements (ADR 0001, security
control 21). Internal only: the Node side calls it with a shared secret.

| Endpoint | Auth | What |
| --- | --- | --- |
| `GET /health` | none | liveness |
| `GET /parsers` | `X-Parser-Secret` | registered parsers `{id, kind, version}` |
| `POST /detect` | `X-Parser-Secret` | body = file bytes → ranked `{parser_id, kind, version, confidence}` |
| `POST /parse?parser_id=…` | `X-Parser-Secret` | body = file bytes → `{rows, meta, warnings}` |
| `POST /propose` | `X-Parser-Secret` | body = csv bytes → `{spec, header, preview}`: a guessed column mapping (an import spec) for the user to confirm |
| `POST /parse-spec` | `X-Parser-Secret` + `X-Import-Spec` | body = file bytes, header = the spec as base64url JSON → `{rows, meta, warnings}`; used to reuse a confirmed mapping |

The file is the raw request body (not multipart) so it can be refused as soon as it passes 10 MB.
Errors are `{code, message}`; a message never contains file content.

## How a request is handled

1. Secret checked in constant time (401), then the body is read up to 10 MB (413).
2. Detect/parse runs in a throw-away child process with a 20 s limit (504) and a CPU limit.
3. Inside it: type sniffing (`xlsx`, `pdf`, `csv`), zip limits (entries, expanded size, ratio → 422),
   then the parsers. Output is re-validated against the row models before it leaves.

## Import specs

A spec is a declarative JSON (`schemas/import-spec.schema.json`, schema v1, generated from
`engine/spec.py` by `pnpm parser:schema`) run by the fixed engine in `engine/`. It is strict
(unknown keys and over-long strings are rejected) so the same engine can run specs written by users
or, in phase 5, by a model.

- Specs in `specs/*.json` are validated at start-up and registered as parsers (a broken one stops
  the service). They hold structure only, never personal data.
- `detect` scores how many of `fingerprint.headers` the file's first rows have (75% is the
  minimum; all of them scores 0.95).
- The engine finds the header row (`table.headerRow`, the fingerprint headers, `headerRowHint` or the
  prototype's `findHeader`), reads dates by `formats.date` and numbers by `decimal` / `thousands` /
  `negative`, stops by `table.stopAt`, drops rows matching `filters.skipIfDescriptionMatches`
  (bounded regular expressions with a timeout) and checks that the balances follow from the amounts.
- **Generic csv:** `POST /propose` guesses the columns (`guessMap`), date format and separators and
  returns a complete spec plus a preview. The app saves the confirmed spec per account and sends it
  back with `POST /parse-spec` on the next import.

## Adding a parser

Implement the `Parser` protocol (`parsers/base.py`), register it in `default_registry()`
(`registry.py`), add fixtures and their expected detections to `tests/test_detection_matrix.py`.
Rows must be `BankRow` / `BrokerRow` (`models.py`). After changing a model run `pnpm parser:schema`
and `pnpm gen:parser-schema` from the repository root.

## Commands (from this folder)

```bash
uv sync                     # install (Python 3.12)
uv run pytest               # unit tests
uv run pytest -m docker     # isolation tests on the built image (needs Docker)
uv run ruff check . && uv run ruff format --check . && uv run mypy
```
