---
name: nestvault-domain
description: NestVault business rules and calculation engine — average cost, realized gains, XIRR, total return, dividends and withholding tax, deposit interest schedules, internal transfer detection, category rules, refunds, portfolio cash, net worth, FX, and goal projections — plus the reference values the tests must reproduce. Use it whenever you write or change anything in packages/domain, port a calculation from the prototype, write domain tests, or a number shown in the app (património, investimentos, rendimento passivo, despesas, objetivos) looks wrong.
---

# NestVault domain

`packages/domain` is a pure-TypeScript port of the prototype's engine
(`docs/prototype/cofre-familiar-v28.html`). No I/O: functions receive plain data for one pool and
return results. The prototype's numbers were validated against real statements, so **the port
must reproduce them exactly** — when in doubt, read the prototype function and match it.

Read `references/rules.md` for the full rules and formulas. It maps each rule to its prototype
function so you can open the original.

## Principles

- **Decimals, not floats.** Money and quantities are strings at the boundary and a decimal type
  (`decimal.js` or `big.js`) inside. Round only for display, or where the prototype rounds
  (deposit interest is rounded to cents per period).
- **Native currency first.** Positions are computed in the asset's currency; EUR values derive
  from FX. Totals on the overview are always EUR; inside a portfolio, use the portfolio currency.
- **Each account counts once** in net worth, even when linked to a portfolio.
- **Deterministic `today`.** Every function that depends on the date takes `asOf` as a parameter
  (default only at the service layer) so tests are reproducible.
- **Same inputs, same order.** Sort operations by date (buys before sells on the same date for
  realized gains), as the prototype does.

## Workflow for porting a function

1. Find it in the prototype (`grep -n "function <name>" docs/prototype/cofre-familiar-v28.html`).
2. Write the test first, with the reference values below or a hand-checked case.
3. Port with types and decimals; keep the prototype's behaviour (including edge cases like
   `NaN` for XIRR with < 30 days of history).
4. Add property-style tests for invariants (e.g. selling everything leaves qty 0 and cost 0).

## Reference values (must be reproduced by tests)

| Case | Values |
| --- | --- |
| XTB account 50611139 | cash 11.25 USD · gross dividends 70.75 USD · tax −10.69 USD · tax refund +4.24 USD · deposits 1284.39 USD · PRD fixture value 1361.87 USD (confirm what it represents against the prototype) |
| BPI statement of 2026-09-01 | balance 3959.43 € |
| Trade Republic | balance 5285.98 € · interest last 12 months 100.52 € · total 197.38 € |
| Banco Invest (Invest Tendências Globais @ 8.017 €) | Rui 1234.9144 units / 9900.31 € · Liliana 596.7909 / 4784.47 € · Simão 504.8609 / 4047.47 € · Vicente 309.5371 / 2481.56 € · market value 21213.81 € · invested 19066.66 € |
| Default FX (editable) | USD 0.92 · GBP 1.17 · CHF 1.06 (EUR per unit) |

Statement fixtures are anonymized (see `new-importer`); the totals above must still hold.
