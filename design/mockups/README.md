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
| `29-imovel-prestacoes` | Installment table with configurable columns, period summary that follows the active fields |
| `45-imovel-prestacoes-colunas` | Same page with the "Colunas e campos" menu open (basic columns, optional fields, new field) |
| `30-imovel-eventos-e-anos` | "Pago por anos" table, rate over time, events timeline |
| `31-imovel-obras` | Works projects with payment phases (planned vs paid date) |
| `32-imovel-venda-e-simulador` | Sale analysis, simulator, pace to the 20-year goal, compounded inflation |
| `33-imobiliario-free-pre-visualizacao` | Same page for a Free pool: demo data, lock icons, banner |
| `34-imovel-free-dialogo-pro` | Free pool clicking any action → "Plano Pro" dialog |
| `35-definicoes-plano` | Plan, usage vs limits, Free vs Pro comparison |
| `36-definicoes-utilizadores-free` | Users and invites (invite locked on Free), role matrix |
| `modal-37…39` | Pro dialog (owner), Pro dialog (member without permission), plan limit reached |
| `modal-40…44`, `modal-46` | New property, new loan, loan event (prepayment), new works project, spreadsheet import, new installment field |
| `mobile-07`, `mobile-08` | Property summary, Free preview with Pro dialog |

New shared pieces (documented here until promoted to `DESIGN-SYSTEM.md`): `PRO` tag (violet gradient
pill), `EXEMPLO` chip (dashed, `--warn`), lock icon on locked buttons, vertical timeline, plan comparison grid.

## Regenerating

The real estate and plan mockups are rendered from `src/` with Playwright:

```
NODE_PATH=$(npm root -g) node design/mockups/src/build.cjs [name-filter]
```

`src/sheet-installments.json` holds the 73 installments extracted from the spreadsheet.

## Authentication, invites, pools, members and account (47–65, modal 66–68, mobile 09–11)

Specified in `FR — Pools, members and user account`. Auth screens use a two-column layout (brand panel +
card; the panel is hidden on mobile). Sign-up is closed by default, so the login footer points to invites.

| File | Route | What it shows |
| --- | --- | --- |
| `47-login` | `/login` | Email, password, forgot link, 30-day session note |
| `48-login-credenciais-invalidas` | `/login` | Generic error (never says which field is wrong) |
| `49-login-demasiadas-tentativas` | `/login` | Rate limit: disabled button with countdown |
| `50-registar` | `/registar` | Sign-up (only when `ALLOW_SIGNUP=true`): password meter and requirements (min 12) |
| `51-registar-fechado` | `/registar` | Sign-up closed: explains the invite-only rule |
| `52` / `53` / `54` / `55` | `/recuperar`, `/recuperar/[token]` | Request reset, neutral confirmation, new password, invalid or expired link |
| `56` / `57` | `/verificar/[token]` | Email verification pending / confirmed |
| `58` … `61` | `/convite/[token]` | Invite: public, accept (signed in), different email, expired |
| `62` / `63` | `/pools` | Choose a pool (with pending invite) / create the first pool |
| `64-definicoes-utilizadores-e-convites` | `/[poolId]/definicoes/membros` | Members, roles, pending invites, ownership |
| `65-conta` | `/conta` | Profile, password, active sessions, 2FA placeholder (phase 4), export, delete |
| `69-definicoes-agregado` | `/[poolId]/definicoes` | Pool settings: name, base currency, parameters, backup/export, danger zone (transfer, leave, delete) |
| `70-seletor-de-agregado` | sidebar | Pool switcher open (shown only when the user belongs to more than one pool) |
| `76-definicoes-auditoria` | `/[poolId]/definicoes/auditoria` | Audit log (owner only): filters by action, person and period, read-only table, CSV export |
| `77-definicoes-auditoria-detalhe` | | Entry selected: detail panel with allow-listed action data |
| `78-definicoes-auditoria-sem-resultados` | | Empty state with active filters |
| `mobile-12-auditoria` | | Audit log on mobile |
| `modal-66…68` | | Invite user, transfer ownership, delete account blocked |
| `modal-71…75` | | Delete pool, leave pool, leave blocked (last owner), remove member, change role |
| `mobile-09…11` | | Login, sign-up, invite on mobile |

Definições now has four tabs: Agregado e parâmetros · Plano e subscrição · Utilizadores e convites · Auditoria (owner only).

New shared pieces: auth layout, icon inputs with show/hide, password strength meter and requirement list,
inline alerts (`err`/`warn`/`ok`/`info`), big status icon, divider, `.pool-card`.

## Installment fields (Prestações)

Basic columns: number/date, amortization, interest, total (plus optional Em falta, Estado, Movimento).
Optional **loan fields** (Seguro vida and Seguro casa on by default; Seguro crédito, Comissões, Imposto de
selo and custom ones off until enabled): an enabled field adds a column and counts in the row total, the
period summary, "Pago por ano" and the cost of the loan. Spreadsheet imports enable the fields that have values.
