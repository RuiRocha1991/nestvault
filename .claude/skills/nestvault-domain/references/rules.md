# Business rules and formulas

Each rule names the prototype function that implements it (`docs/prototype/cofre-familiar-v28.html`).
Rules 1–14 of `docs/handoff.md` are the validated summary; this file adds the formulas.

## Contents
1. Currency and FX
2. Positions, average cost, realized gains (`holdings`, `sellGains`, `opCashEffect`)
3. Portfolio summary and total return (`pfSummary`)
4. XIRR (`xirr`)
5. Dividends (`holdings`, `divForecast`, XTB import)
6. Portfolio cash (`pfCash`)
7. Accounts and net worth (`accBalance`, `totals`)
8. Savings products and deposits (`depSchedule`, `depFlows`, `depLink`)
9. Transactions: kinds, transfers, rules, refunds (`txKind`, `detectTransfers`, `applyRules`, `kwMatch`)
10. Goals (`goalCalc`)
11. Number parsing (`parseNum`)

---

## 1. Currency and FX
- `fx(ccy)` = EUR per unit (EUR = 1). Defaults USD 0.92, GBP 1.17, CHF 1.06; later from the ECB job.
- Accounts hold balances in their own currency; UI shows `1361,87 US$ (1252,92 €)`.
- Overview totals in EUR; inside a portfolio, values in the portfolio currency.
- Term deposits (`prazo`) are always EUR in totals.

## 2. Positions (`holdings`)
Per asset (and per account/sub-account when filtered — the position key is asset + account +
sub-account), operations sorted by date, all in the asset's native currency N:
- **buy:** `qty += q`; `costN += q × price + fee / fx`
- **sell:** `avg = costN / qty`; `q' = min(q, qty)`; `costN -= avg × q'`;
  `realizedN += q' × price − fee/fx − avg × q'`; `qty -= q'`
- **div:** `divsN += amount`; when `gross > 0 && tax > 0`, accumulate gross and tax for the
  withholding rate `wht = Σtax / Σgross`.
- Derived: `valueN = qty × price(asOf)`, `gainN = valueN − costN`,
  `totalN = gainN + realizedN + divsN`, `incomeN = qty × dps` (annual dividend per share),
  `incomeNetN = incomeN × (1 − wht)`, `avg = costN / qty`. EUR = native × fx.
- Positions with `qty ≤ 1e-9` are closed; weights are value / total value of open positions.
- **Realized gains per sale** (`sellGains`): same average-cost method but in EUR at current FX,
  sorting buys before sells on the same date.
- **Cash effect** of an op (`opCashEffect`, EUR): buy `−(q × price × fx + fee)`;
  sell `q × price × fx − fee`; div `amount × fx`. Fees are stored in EUR.

## 3. Portfolio summary and total return (`pfSummary`)
- Total gain (Snowball style) per currency =
  unrealized gain of open positions + gross dividends − withholding taxes + tax refunds
  + realized sales + other (interest of linked accounts / deposit net value).
- `valueAll` = open positions value + cash (tracked brokerage account balances + portfolio cash
  + linked accounts). `netInvested = valueAll − profit`; `profitPct = profit / netInvested`
  (only when `netInvested > 0.5`).
- Dividends last 12 months = Σ cash effect of `div` ops with date > today − 12 months.

## 4. XIRR (`xirr`)
- Flows: each op's cash effect at its date, plus the current value (positive) at `asOf`.
- `NaN` when fewer than 2 flows, no negative or no positive flow, or the span is < 30 days.
- `t_i = days(d0, d_i) / 365`; NPV(r) = Σ v_i / (1+r)^t_i; bisection on [−0.99, 10], 200
  iterations, tolerance 1e-7; `NaN` if no sign change.

## 5. Dividends
- Forecast (`divForecast`): for each open position with `dps > 0` and payment months, each
  payment month gets `qty × dps / months.length × fx`.
- XTB: dividends grouped by symbol and date; withholding tax (negative) and tax refunds (positive)
  are separate lines. The account card shows gross, taxes, refunds and net.

## 6. Portfolio cash (`pfCash`)
Sales and dividends whose cash account does **not** track cash (`trackCash = false`, e.g. PPR
paid by direct debit) stay in the portfolio's cash:
`pfCash = Σ cashEffect(sell, div, and buys flagged fromCash) for untracked accounts + Σ manual moves`.
Moving cash to an account (`portfolio_cash_moves`) may create the mirror transaction or not (when it
will come in the bank statement).

## 7. Accounts and net worth (`totals`)
- Account balance = opening + Σ transactions (+ deposit logic for `prazo`).
- `cash` = checking + brokerage balances (EUR) + all portfolio cash;
  `savings` = savings (`remunerada`) + term deposits; `inv` = Σ positions value;
  `net = cash + savings + inv`. Each account counted once even if linked to a portfolio.
- Accounts can have several holders; brokerage accounts have sub-accounts (one per holder, e.g.
  Banco Invest), each with its own units and average cost.

## 8. Savings products and deposits (`depSchedule`, `depFlows`, `depLink`)
- Product: rate (TANB, %), pays every N months/days from the application date, optional term,
  tax (default 28%), interest either capitalizes or goes to `payTo` account.
- Schedule: for k = 1.., `d = start + k × N units`, clamped to maturity; stop at maturity or
  `today + 24 months` when open-ended.
  `gross = round2(base × rate × days / 365)`, `net = round2(gross × (1 − tax))`;
  if no `payTo` (capitalizes), `base += net`.
- Flows on the funding/payout accounts: capital out on `start` from `fundFrom`; each net interest
  into `payTo`; at maturity capital (+ capitalized interest) back to the return account.
- Linking (`depLink`): match statement transactions to these flows — same sign, amount within
  0.011 (capital) or max(0.05, 2%) (interest), date within ±5 days. Linked capital becomes an
  internal transfer; linked interest is marked as that deposit's interest. This prevents counting
  the same money twice.

## 9. Transactions
- **Kind** (`txKind`): `transfer` if flagged; else the category kind (expense, income, refund,
  transfer, invest); else sign (negative = expense).
- **Transfer detection** (`detectTransfers`): unpaired, unlocked transactions; an outflow pairs
  with an inflow of exactly the same amount (cents), in a **different account of the same
  currency**, within `tdays` (default 3) days — the closest date wins. Both get the transfer
  category, or the investment category when the destination is a brokerage account (unless the
  category was set manually).
- **Rules** (`applyRules`), on the normalized description (no accents, uppercase, single spaces),
  skipped when the category was set manually:
  1. If it looks like a transfer (`TRF|TRANSF|TRANSFERENCIA|MB WAY`): an IBAN of another own
     account → internal transfer. A holder alias (account outside the app) → outflow =
     "Envios para contas próprias fora da app" (an expense), inflow = "Reembolsos" (refund,
     reduces expenses).
  2. Otherwise, the first rule (ordered by position, optionally restricted to one account) whose
     keyword matches **at the start of a word** (`kwMatch`: preceded by start or a non
     `[A-Z0-9]` char) sets the category.
- Suggested keyword: the IBAN in the description when present (preferred), otherwise the
  description without bank noise words.

## 10. Goals (`goalCalc`)
- Types: `value` (current value), `invested` (net invested, no growth), `income` (passive income),
  `contrib` (amount invested in a given year). Scope: portfolios or accounts/sub-accounts.
- Modes: `date` (deadline), `eta` (no date — compute when reached), `none` (track only).
- Monthly rate `i = (1 + r)^(1/12) − 1` (`i = 0` for `invested`);
  `fv(pv, m, p) = pv(1+i)^m + p((1+i)^m − 1)/i` (or `pv + p·m` when `i = 0`).
- `income` target converts to a value target `target / yield` (goal yield, else portfolio yield,
  else 3%).
- `date` mode: `required = gap × i / ((1+i)^n − 1)` with `gap = valueTarget − pv(1+i)^n`;
  on track when projected ≥ 99.9% of target.
- `contrib`: current = buys in the deadline year; projected = current + active plans × months left.
- Status: Atingido / No ritmo / Abaixo do ritmo / Atinges em <mês> / Sem contribuição / Em curso
  (UI strings via i18n).

## 11. Number parsing (`parseNum`)
Strip spaces, `€`, `EUR`, NBSP. `(x)` or trailing `-` → negative. If both `,` and `.` present, the
last one is the decimal separator. Only `,` → decimal comma. Only `.` with groups of 3
(`1.234.567`) → thousands separator.
