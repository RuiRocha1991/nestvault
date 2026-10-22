# Parser service

Isolated Python service that detects and parses bank and broker statements (ADR 0001, security
control 21). Internal only: the Node side calls it with a shared secret.

| Endpoint | Auth | What |
| --- | --- | --- |
| `GET /health` | none | liveness |
| `GET /parsers` | `X-Parser-Secret` | registered parsers `{id, kind, version}` |
| `POST /detect` | `X-Parser-Secret` | body = file bytes → ranked `{parser_id, kind, version, confidence}` |
| `POST /parse?parser_id=…` | `X-Parser-Secret` | body = file bytes → `{rows, meta, warnings}` |

The file is the raw request body (not multipart) so it can be refused as soon as it passes 10 MB.
Errors are `{code, message}`; a message never contains file content.

## How a request is handled

1. Secret checked in constant time (401), then the body is read up to 10 MB (413).
2. Detect/parse runs in a throw-away child process with a 20 s limit (504) and a CPU limit.
3. Inside it: type sniffing (`xlsx`, `pdf`, `csv`), zip limits (entries, expanded size, ratio → 422),
   then the parsers. Output is re-validated against the row models before it leaves.

## Shipped parsers

| Id | Kind | Input | Notes |
| --- | --- | --- | --- |
| `trade-republic-pdf` | bank | Trade Republic account statement (PDF, pt-PT) | Rows carry `type` (`transfer`, `card`, `interest`, `trade`, `dividend`, `other`); `interest` rows feed `deposits.link`. Reconciles the opening balance plus movements against the closing balance. |
| `generic-pdf-lines` | bank | any PDF with one `dd-mm-yyyy description value balance` line per movement | Confidence 0.5 (the threshold): a named parser always wins. |

PDF text comes from `pdfplumber` only (no poppler). `tests/support/trade_republic.py` generates the
fixture statement; the golden test runs `docs/tools/extrato_para_csv.py` on it and compares.

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
