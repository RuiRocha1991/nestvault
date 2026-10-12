# Mockups

PNG mockups of the v28 design in `escuro/` (dark) and `claro/` (light). Source of truth for visuals
is still the prototype and `design/DESIGN-SYSTEM.md`.

## Real estate and plans (27–44, mobile 07–08)

Based on the owner's spreadsheet *Crédito Habitação com Obras* and `FR — Real estate and loans (Pro)`
(Confluence). Figures on the Pro pages come from the spreadsheet (73 installments paid through
09/2026, 15 000 € prepayment in 02/2023, 4 works projects, outstanding 86 088,28 €); installments after
that are projected at the current 2,40 % rate. Free pages use fictional demo data (ADR 0003 addendum).

| File | What it shows |
| --- | --- |
| `27-imobiliario-lista` | Properties, loans, net-worth effect (Pro) |
| `28-imovel-resumo` | Equity, loan progress, capital vs interest per contract year, where the money went |
| `29-imovel-prestacoes` | Installment table (paid / projected, bank link status) |
| `30-imovel-eventos-e-anos` | "Pago por anos" table, rate over time, events timeline |
| `31-imovel-obras` | Works projects with payment phases (planned vs paid date) |
| `32-imovel-venda-e-simulador` | Sale analysis, simulator, pace to the 20-year goal, compounded inflation |
| `33-imobiliario-free-pre-visualizacao` | Same page for a Free pool: demo data, lock icons, banner |
| `34-imovel-free-dialogo-pro` | Free pool clicking any action → "Plano Pro" dialog |
| `35-definicoes-plano` | Plan, usage vs limits, Free vs Pro comparison |
| `36-definicoes-utilizadores-free` | Users and invites (invite locked on Free), role matrix |
| `modal-37…39` | Pro dialog (owner), Pro dialog (member without permission), plan limit reached |
| `modal-40…44` | New property, new loan, loan event (prepayment), new works project, spreadsheet import |
| `mobile-07`, `mobile-08` | Property summary, Free preview with Pro dialog |

New shared pieces (documented here until promoted to `DESIGN-SYSTEM.md`): `PRO` tag (violet gradient
pill), `EXEMPLO` chip (dashed, `--warn`), lock icon on locked buttons, vertical timeline, plan comparison grid.

## Regenerating

The real estate and plan mockups are rendered from `src/` with Playwright:

```
NODE_PATH=$(npm root -g) node design/mockups/src/build.cjs [name-filter]
```

`src/sheet-installments.json` holds the 73 installments extracted from the spreadsheet.
