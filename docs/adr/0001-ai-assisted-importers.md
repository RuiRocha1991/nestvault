# ADR 0001 — Python parser service with automatic detection and AI-assisted import specs

- **Status:** Accepted (design). Implementation: parser service and registry in phase 3; AI-assisted
  specs in phase 5.
- **Date:** 2026-10-11
- **Supersedes:** PRD section "Importadores" (importers as a TypeScript package, one module per format).

## Context

Users import bank and broker statements (CSV, xlsx, PDF). Today we support, or have reference code
for: BPI xlsx, XTB xlsx and generic bank CSV (JavaScript, in the prototype), and Banco Invest xlsx and
Trade Republic PDF (Python scripts in `docs/tools/`). Every new bank needs a new parser, and
families use many banks.

Goals:
1. **Automatic import:** the user uploads a file; the app detects which parser to use. No manual
   column mapping when the format is known.
2. **Self-extending:** when a format is not supported, AI creates the parser, and once proven it
   becomes available to every other user with the same format.
3. Keep the existing Python work (Banco Invest, Trade Republic) instead of rewriting it.

The naive version — let AI write Python code from the uploaded file and run it automatically for
everyone — is rejected:
- **Prompt injection through the file:** the statement is untrusted input. Text hidden in a PDF can
  steer the model into generating malicious code.
- **Cross-pool blast radius:** that code would run on our servers for other pools' imports, with
  access to their files and data.
- **Privacy:** sending whole statements (names, IBANs, movements) to an external AI API.

## Decision

### 1. One parser service, in Python

A new service `services/parser` (Python, FastAPI, `pdfplumber`, `openpyxl`) owns all statement
parsing. It runs as its own Docker container and is **isolated**:
- no access to the databases or object storage, no outbound network (internal Docker network only);
- input: file bytes + optional parser id; output: parsed rows as JSON validated against a schema;
- limits: 10 MB per file, CPU time and memory limits per job, zip-bomb guards for xlsx, regex timeouts;
- runs as a non-root user with a read-only filesystem.

The Node side (`packages/services/imports`) keeps the pipeline, guards and persistence:
upload → store encrypted → call parser service → validate rows (zod) → dedup/hash → preview →
commit in `withPool` → `deposits.link`.

### 2. Two kinds of parser behind one interface

```
detect(file) -> confidence 0..1     parse(file) -> { rows, meta, warnings }
```

- **Code parsers:** hand-written Python, reviewed and tested (Trade Republic PDF, Banco Invest xlsx,
  XTB xlsx, BPI xlsx, generic CSV). New code parsers only enter the repository via a reviewed PR.
- **Spec parsers:** a declarative JSON **import spec** run by a fixed, tested **spec engine**.
  The spec describes structure only and contains no personal data:

```json
{
  "id": "millennium-xlsx-v1",
  "kind": "bank",
  "fingerprint": { "type": "xlsx", "sheet": "Movimentos",
                   "headers": ["Data Mov.", "Descritivo", "Débito", "Crédito", "Saldo"] },
  "table": { "headerRow": 7, "stopAt": "empty-row" },
  "columns": { "date": "Data Mov.", "description": "Descritivo",
               "debit": "Débito", "credit": "Crédito", "balance": "Saldo" },
  "formats": { "date": "dd-mm-yyyy", "decimal": ",", "thousands": "." }
}
```

  For PDFs the spec describes page text markers and line patterns (bounded regular expressions,
  executed with a timeout by the engine). The spec schema is versioned and validated strictly;
  anything outside it is rejected.

### 3. Automatic detection

On upload, every active parser returns a confidence from the file's fingerprint (file type, sheet
names, header row, PDF key phrases, column count). The highest score above a threshold wins; ties
or low scores ask the user to choose. The chosen parser id is stored on the import batch, and the
account remembers it for the next import.

### 4. AI-assisted specs for unknown formats (phase 5)

When no parser matches:
1. **Structure extraction, on our server:** headers, sheet names, PDF layout lines and 3–5 sample
   rows with values **synthesized** (names, IBANs, descriptions and amounts replaced by fake values of
   the same shape). The full statement never leaves the server.
2. **Generation:** the AI (Claude API, structured output constrained to the spec JSON schema)
   returns an import spec. Its output is data, never code.
3. **Automatic validation** of the spec on the real file, inside the parser service:
   - schema-valid spec; every row parses with valid date and amount;
   - **balance reconciliation** when a balance column exists: opening balance + Σ movements equals
     each running balance and the closing balance;
   - row count matches the number of movement-like lines;
   - on failure, the error (not the data) goes back to the AI; at most 3 attempts.
4. **Preview:** the user sees the parsed movements and confirms. Nothing is written without that.
5. **Promotion levels:**
   - `draft` — only usable by the pool that created it;
   - `verified` — after N confirmed imports with reconciliation passing (N = 3, configurable), or
     approval by an app administrator;
   - `global` — detected automatically for everyone.
   A global spec that starts failing reconciliation is demoted automatically and the admin is notified.
6. **Escalation to code:** if a format cannot be expressed as a spec, the system opens a GitHub PR
   with a proposed Python code parser and an anonymized fixture, for human review. It is never
   deployed without that review.

Cost and abuse controls: AI generation limited per pool (e.g. 5 per day) and globally; generation
only for authenticated members with `imports.run`; every generation logged in the audit log
(without file content).

### Data model additions

- `import_specs` (global, no `pool_id`; written only by the service account):
  `id, version, kind, fingerprint jsonb, spec jsonb, status (draft|verified|global|disabled),
  created_by_pool_id, success_count, failure_count, created_at, promoted_at, promoted_by`.
  Draft specs are only visible to their `created_by_pool_id` — enforced in the repository and by
  an RLS policy.
- `import_batches`: add `parser_id`, `parser_kind (code|spec)`, `parser_version`, `confidence`,
  `reconciled boolean`.

## Consequences

Positive:
- Existing Python scripts are reused almost as they are.
- Supporting a new bank usually needs no deploy; the parser library grows with usage.
- AI output can never execute; the worst case is a wrong spec, caught by reconciliation and preview.
- Statement content does not go to the AI provider.

Negative / costs:
- One more runtime (Python) and container to maintain, test and secure.
- The spec engine must be expressive enough for most banks; complex PDFs may still need code parsers.
- AI usage has a cost; needs an API key (server-side only) and limits.

## Security notes (see `docs/security.md` §21)

- Uploaded files and AI prompts are untrusted; AI output is validated as data against a strict schema.
- The parser service has no network, no DB credentials, and resource limits.
- Only synthesized structure is sent to the AI provider.
- Code parsers enter only through reviewed PRs.

## Delivery plan

| Phase | Work |
| --- | --- |
| 3 | Parser service skeleton (Docker, isolation, limits); parser registry and detection; code parsers: Trade Republic and Banco Invest (port of `docs/tools`), BPI, XTB, generic CSV; spec engine v1 with a hand-written spec for the generic CSV; `import_batches` parser fields; fixtures and tests |
| 5 | Structure extraction and synthesis; AI spec generation with validation loop; `import_specs` table and promotion levels; admin approval screen; per-pool limits; escalation PR flow |
