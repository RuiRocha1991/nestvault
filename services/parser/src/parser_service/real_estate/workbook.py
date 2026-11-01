"""The owner's mortgage workbook (xlsx), `mortgage-workbook-xlsx`.

Sheets, found by name without accents or case:

- `Sumário`: one installment per row (number, date, amortização, juros and the optional
  components: seguro vida / casa / crédito, comissões, imposto de selo). Its totals column is
  ignored: the app recomputes it.
- `Amortização`: prepayments (date, valor, comissão).
- `Resumo`: label / value pairs; only the acquisition costs are read (escritura, IMT, imposto de
  selo, registo, despesas bancárias). Its totals are recalculated by the app.
- `Remodelações`: one works project per row (obra, fornecedor, orçamento, entrada, estado, início,
  fim previsto).
- `Pagamentos`: one payment phase per row (obra, descrição, valor, data prevista, data pagamento).
- `Inflação`: yearly consumer price changes (ano, IPC).
- `Pago por anos` and `Plano de pagamento` are derived tables: recognised, not imported.

Formulas are never evaluated: only the cached values the file carries are read, and a cell whose
formula has no cached value counts as empty.

Warnings are codes (`code` or `code:count`), not sentences: the web app words them in Portuguese.

- `installments_without_values:N`, `installments_repeated:N`
- `prepayments_table_missing`, `works_table_missing`, `payments_table_missing`,
  `inflation_table_missing`
- `payments_paid_without_date:N`
- `prepayment_removed_from_capital:N` (installments stored without the prepayment their capital
  carried) and `prepayment_not_in_capital:N` (a prepayment the capital did not include)
- `deposit_read_as_fraction:N` and `deposit_one_read_as_percent:N` (see `_deposit`)
- `stamp_duty_not_found` (an "Imposto de selo" line outside the acquisition section)

Limits, like `sniff`: at most `MAX_SHEETS` sheets and `MAX_COLUMNS` columns are read.
"""

import io
import warnings
from decimal import Decimal
from typing import Any

import openpyxl

from ..errors import ParseFailedError, UnsupportedFileError
from ..sniff import MAX_COLUMNS, MAX_SHEETS, SniffedFile
from .models import (
    AcquisitionCosts,
    InflationRow,
    InstallmentRow,
    PrepaymentRow,
    RealEstateMeta,
    RealEstateParseResponse,
    RealEstateRow,
    SheetSummary,
    WorkRow,
)
from .tables import (
    INFLATION_COLUMNS,
    INSTALLMENT_COLUMNS,
    INSTALLMENT_REQUIRED,
    PAYMENT_COLUMNS,
    PREPAYMENT_COLUMNS,
    WORK_COLUMNS,
    at,
    date_of,
    find_header,
    header_key,
    installment_row,
    int_of,
    money_of,
    payment_row,
    text_of,
    work_status,
)

INSTALLMENTS = "SUMARIO"
PREPAYMENTS = "AMORTIZACAO"
SUMMARY = "RESUMO"
WORKS = "REMODELACOES"
PAYMENTS = "PAGAMENTOS"
INFLATION = "INFLACAO"
DERIVED = ("PAGO POR ANOS", "PLANO DE PAGAMENTO")
OTHER_SHEETS = (PREPAYMENTS, SUMMARY, WORKS, PAYMENTS, INFLATION)

_COSTS: dict[str, tuple[str, ...]] = {
    "deed": ("ESCRITURA", "CUSTO ESCRITURA", "DEED"),
    "imt": ("IMT",),
    "stamp_duty": ("IMPOSTO DE SELO COMPRA", "IMPOSTO DE SELO AQUISICAO", "STAMP DUTY"),
    "registration": ("REGISTO", "REGISTO PREDIAL", "REGISTRATION"),
    "bank_fees": ("DESPESAS BANCARIAS", "COMISSOES BANCARIAS", "BANK FEES"),
}
_LABELS = {
    INSTALLMENTS: ("Sumário", "Installments (capital, interest, fees, taxes, insurances)"),
    PREPAYMENTS: ("Amortização", "Prepayments"),
    WORKS: ("Remodelações", "Works: budget, supplier, deposit, status"),
    PAYMENTS: ("Pagamentos", "Payment phases of the works"),
    INFLATION: ("Inflação", "Yearly consumer price changes"),
}
# A bare "Imposto de selo" is also the stamp tax of the loan; it counts as the purchase one only
# inside the acquisition section of the Resumo sheet.
_AMBIGUOUS_STAMP = ("IMPOSTO DE SELO", "IMPOSTO SELO")
_PURCHASE_SECTION = ("AQUISICAO", "COMPRA")
_MAX_ROWS = 5000


def _sheet_names(names: tuple[str, ...]) -> dict[str, str]:
    """Normalised name -> real name."""
    return {header_key(name): name for name in names}


class MortgageWorkbookXlsx:
    id = "mortgage-workbook-xlsx"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "xlsx":
            return 0.0
        sheets = _sheet_names(file.sheet_names)
        name = sheets.get(INSTALLMENTS)
        if name is None:
            return 0.0
        head = file.header_rows.get(name, [])
        if find_header(head, INSTALLMENT_COLUMNS, INSTALLMENT_REQUIRED) is None:
            return 0.0
        known = sum(1 for other in OTHER_SHEETS if other in sheets)
        return round(0.5 + 0.1 * known, 4)

    def parse(self, file: SniffedFile) -> RealEstateParseResponse:
        workbook = _open(file.data)
        try:
            sheets = _sheet_names(tuple(workbook.sheetnames[:MAX_SHEETS]))
            tables = {key: _rows(workbook[real]) for key, real in sheets.items()}
        finally:
            workbook.close()
        if INSTALLMENTS not in tables:
            raise ParseFailedError('The "Sumário" sheet was not found.')

        warnings_out: list[str] = []
        rows: list[RealEstateRow] = []
        summary: list[SheetSummary] = []

        installments = _installments(tables[INSTALLMENTS], warnings_out)
        prepayments: list[RealEstateRow] = []
        if PREPAYMENTS in tables:
            prepayments = _prepayments(tables[PREPAYMENTS], warnings_out)
            installments = _without_prepayments(installments, prepayments, warnings_out)
        rows += installments
        summary.append(_line(INSTALLMENTS, len(installments)))
        if PREPAYMENTS in tables:
            rows += prepayments
            summary.append(_line(PREPAYMENTS, len(prepayments)))

        works = _works(tables[WORKS], warnings_out) if WORKS in tables else []
        if WORKS in tables:
            rows += works
            summary.append(_line(WORKS, len(works)))

        if PAYMENTS in tables:
            payments = _payments(tables[PAYMENTS], warnings_out)
            rows += payments
            summary.append(_line(PAYMENTS, len(payments)))

        if INFLATION in tables:
            inflation = _inflation(tables[INFLATION], warnings_out)
            rows += inflation
            summary.append(_line(INFLATION, len(inflation)))

        costs = _costs(tables[SUMMARY], warnings_out) if SUMMARY in tables else None
        derived = [real for key, real in sheets.items() if key == SUMMARY or key in DERIVED]
        if derived:
            summary.append(
                SheetSummary(
                    sheet=" · ".join(derived),
                    label="Recalculated by the app from the installments",
                    rows=0,
                    action="recalculated",
                )
            )
        if not installments:
            raise ParseFailedError("The installments table has no usable rows.")
        return RealEstateParseResponse(
            rows=rows,
            meta=RealEstateMeta(
                parser_id=self.id,
                parser_version=self.version,
                row_count=len(rows),
                acquisition_costs=costs,
                sheets=summary,
            ),
            warnings=warnings_out,
        )


def _line(key: str, count: int) -> SheetSummary:
    """CPI rows are shown but the app has nowhere to store them (`shown`); the rest is imported."""
    sheet, label = _LABELS[key]
    action = "shown" if key == INFLATION else "import"
    return SheetSummary(sheet=sheet, label=label, rows=count, action=action)


def _open(data: bytes) -> Any:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # openpyxl warns about styles it does not know
            return openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # openpyxl raises many types for damaged files
        raise UnsupportedFileError("The workbook could not be opened.") from exc


def _rows(sheet: Any) -> list[list[Any]]:
    return [
        list(row)
        for row in sheet.iter_rows(max_row=_MAX_ROWS, max_col=MAX_COLUMNS, values_only=True)
    ]


def _installments(table: list[list[Any]], notes: list[str]) -> list[RealEstateRow]:
    found = find_header(table, INSTALLMENT_COLUMNS, INSTALLMENT_REQUIRED)
    if found is None:
        raise ParseFailedError("The installments table was not found.")
    start, columns = found
    result: dict[int, InstallmentRow] = {}
    skipped = duplicated = 0
    for raw in table[start + 1 :]:
        if not any(cell is not None for cell in raw):
            continue
        row = installment_row(raw, columns)
        if row is None:
            # A totals line has no number; a line with a number but no amounts is a formula
            # without a cached value, which is worth telling.
            if int_of(at(raw, columns, "number")) is not None:
                skipped += 1
            continue
        if row.number in result:
            duplicated += 1
            continue
        result[row.number] = row
    if skipped:
        notes.append(f"installments_without_values:{skipped}")
    if duplicated:
        notes.append(f"installments_repeated:{duplicated}")
    return [result[number] for number in sorted(result)]


def _without_prepayments(
    installments: list[RealEstateRow], prepayments: list[RealEstateRow], notes: list[str]
) -> list[RealEstateRow]:
    """The capital of the installment that carries a prepayment, without the extra amount.

    In the workbook the capital of the month of a prepayment includes the amount amortised
    early. The app stores the prepayment as its own event and counts it once, so that
    installment is stored with its regular capital: file capital minus the prepayment. The
    carrying installment is the first one due on or after the prepayment date. When the capital
    is smaller than the amount (the file does not include it after all) the installment is left
    as it is and a warning says so.
    """
    carriers = [row for row in installments if isinstance(row, InstallmentRow)]
    extra: dict[int, Decimal] = {}
    unmatched = 0
    for prepayment in prepayments:
        if not isinstance(prepayment, PrepaymentRow):
            continue
        carrier = next((row for row in carriers if row.due_date >= prepayment.date), None)
        if carrier is None or Decimal(carrier.capital) < extra.get(carrier.number, 0) + Decimal(
            prepayment.amount
        ):
            unmatched += 1
            continue
        extra[carrier.number] = extra.get(carrier.number, Decimal(0)) + Decimal(prepayment.amount)
    if unmatched:
        notes.append(f"prepayment_not_in_capital:{unmatched}")
    if extra:
        notes.append(f"prepayment_removed_from_capital:{len(extra)}")
    return [
        row.model_copy(update={"capital": _plain(Decimal(row.capital) - extra[row.number])})
        if isinstance(row, InstallmentRow) and row.number in extra
        else row
        for row in installments
    ]


def _plain(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _prepayments(table: list[list[Any]], notes: list[str]) -> list[RealEstateRow]:
    found = find_header(table, PREPAYMENT_COLUMNS, ("date", "amount"))
    if found is None:
        notes.append("prepayments_table_missing")
        return []
    start, columns = found
    result: list[RealEstateRow] = []
    for raw in table[start + 1 :]:
        day = date_of(at(raw, columns, "date"))
        amount = money_of(at(raw, columns, "amount"))
        if day is None or amount is None or Decimal(amount) <= 0:
            continue
        fee = money_of(at(raw, columns, "fee"))
        result.append(
            PrepaymentRow(kind="prepayment", date=day, amount=amount, fee=fee if fee else None)
        )
    return result


def _works(table: list[list[Any]], notes: list[str]) -> list[RealEstateRow]:
    found = find_header(table, WORK_COLUMNS, ("name", "budget"))
    if found is None:
        notes.append("works_table_missing")
        return []
    start, columns = found
    result: list[RealEstateRow] = []
    fractions = ones = 0
    for raw in table[start + 1 :]:
        name = text_of(at(raw, columns, "name"))
        budget = money_of(at(raw, columns, "budget"))
        if name is None or budget is None or Decimal(budget) < 0:
            continue
        deposit, kind = _deposit(money_of(at(raw, columns, "deposit")))
        fractions += kind == "fraction"
        ones += kind == "one"
        result.append(
            WorkRow(
                kind="work",
                name=name,
                supplier=text_of(at(raw, columns, "supplier")),
                budget=budget,
                deposit_pct=deposit,
                status=work_status(at(raw, columns, "status")),
                start_date=date_of(at(raw, columns, "start")),
                planned_end=date_of(at(raw, columns, "end")),
            )
        )
    if fractions:
        notes.append(f"deposit_read_as_fraction:{fractions}")
    if ones:
        notes.append(f"deposit_one_read_as_percent:{ones}")
    return result


def _deposit(value: str | None) -> tuple[str | None, str]:
    """The deposit of a project as a percentage, and how it was read.

    A cell holds either a fraction (0,25 = 25 %) or percentage points (25 = 25 %); the cached value
    does not say which. The rule: strictly between 0 and 1 is a fraction, anything else is already a
    percentage, so exactly 1 is 1 % and never 100 %. Both readings that could surprise are reported
    as warnings.
    """
    if value is None:
        return None, "none"
    share = Decimal(value)
    if 0 < share < 1:
        return money_of(str(share * 100)), "fraction"
    return value, "one" if share == 1 else "percent"


def _payments(table: list[list[Any]], notes: list[str]) -> list[RealEstateRow]:
    found = find_header(table, PAYMENT_COLUMNS, ("work", "description", "amount"))
    if found is None:
        notes.append("payments_table_missing")
        return []
    start, columns = found
    result: list[RealEstateRow] = []
    corrected = 0
    for raw in table[start + 1 :]:
        row, fixed = payment_row(raw, columns)
        corrected += fixed
        if row is not None:
            result.append(row)
    if corrected:
        notes.append(f"payments_paid_without_date:{corrected}")
    return result


def _inflation(table: list[list[Any]], notes: list[str]) -> list[RealEstateRow]:
    found = find_header(table, INFLATION_COLUMNS, ("year", "rate"))
    if found is None:
        notes.append("inflation_table_missing")
        return []
    start, columns = found
    seen: dict[int, InflationRow] = {}
    for raw in table[start + 1 :]:
        year = int_of(at(raw, columns, "year"))
        rate = money_of(at(raw, columns, "rate"))
        if year is None or rate is None or not 1900 <= year <= 2200:
            continue
        seen.setdefault(year, InflationRow(kind="inflation", year=year, rate_pct=rate))
    return [seen[year] for year in sorted(seen)]


def _costs(table: list[list[Any]], notes: list[str]) -> AcquisitionCosts | None:
    """The acquisition costs: label in one cell, amount in the next cell that holds a number.

    A bare "Imposto de selo" is read only inside the acquisition section (a line with a single
    label such as "Custos de aquisição" opens it, any other single label closes it), because the
    loan has a stamp tax line of its own; "Imposto de selo compra" is read anywhere."""
    found: dict[str, str] = {}
    in_purchase = False
    ambiguous_skipped = False
    for raw in table:
        filled = [cell for cell in raw if cell is not None and str(cell).strip() != ""]
        if len(filled) == 1 and isinstance(filled[0], str):
            in_purchase = any(word in header_key(filled[0]) for word in _PURCHASE_SECTION)
            continue
        for position, cell in enumerate(raw):
            key = header_key(cell)
            if key in _AMBIGUOUS_STAMP and not in_purchase:
                ambiguous_skipped = True
                break
            if key in _AMBIGUOUS_STAMP:
                key = "IMPOSTO DE SELO COMPRA"
            field = next((name for name, labels in _COSTS.items() if key in labels), None)
            if field is None or field in found:
                continue
            amount = next(
                (m for m in (money_of(c) for c in raw[position + 1 :]) if m is not None), None
            )
            if amount is not None:
                found[field] = amount
            break
    if ambiguous_skipped and "stamp_duty" not in found:
        notes.append("stamp_duty_not_found")
    return AcquisitionCosts(**found) if found else None
