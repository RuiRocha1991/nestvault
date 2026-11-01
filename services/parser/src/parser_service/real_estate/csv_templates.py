"""The two downloadable CSV templates: installments of a loan and payments of a works project.

Headers are Portuguese (English ones are accepted too), `;` `,` tab or `|` separated, decimal comma
or point, UTF-8 or Windows-1252. Cells are never evaluated. The templates the app offers are in
`templates/` and are the same text as `installments_template()` / `payments_template()`.
"""

import csv
import io
from typing import Any, ClassVar

from ..errors import ParseFailedError
from ..sniff import SniffedFile
from .models import (
    RealEstateMeta,
    RealEstateParseResponse,
    RealEstateRow,
    SheetSummary,
)
from .tables import (
    INSTALLMENT_COLUMNS,
    INSTALLMENT_REQUIRED,
    PAYMENT_COLUMNS,
    find_header,
    installment_row,
    payment_row,
)

INSTALLMENTS_HEADER = (
    "Número;Data;Capital;Juros;Seguro vida;Seguro casa;Seguro crédito;Comissões;Imposto de selo"
)
PAYMENTS_HEADER = "Obra;Descrição;Valor;Data prevista;Data de pagamento"
PAYMENT_REQUIRED = ("work", "description", "amount")
_MAX_ROWS = 5000


def installments_template() -> str:
    return (
        f"{INSTALLMENTS_HEADER}\n"
        "1;2026-01-05;120,50;310,25;12,40;0;0;0;12,41\n"
        "2;2026-02-05;121,10;309,65;12,40;0;0;0;12,39\n"
    )


def payments_template() -> str:
    return (
        f"{PAYMENTS_HEADER}\n"
        "Kitchen;Deposit;1500;2026-01-10;2026-01-12\n"
        "Kitchen;Final payment;2500;2026-03-01;\n"
    )


def _table(file: SniffedFile) -> list[list[Any]]:
    if file.text is None:
        raise ParseFailedError("The file is not a CSV.")
    sample = file.text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(file.text), dialect)
    rows: list[list[Any]] = []
    for row in reader:
        rows.append(list(row))
        if len(rows) >= _MAX_ROWS:
            break
    return rows


class _CsvParser:
    id = ""
    version = "1.0.0"
    spec: ClassVar[dict[str, tuple[str, ...]]]
    required: ClassVar[tuple[str, ...]]

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "csv":
            return 0.0
        head = file.header_rows.get("", [])
        return 0.9 if find_header(head, self.spec, self.required) else 0.0


class LoanInstallmentsCsv(_CsvParser):
    id = "loan-installments-csv"
    spec = INSTALLMENT_COLUMNS
    required = INSTALLMENT_REQUIRED

    def parse(self, file: SniffedFile) -> RealEstateParseResponse:
        table = _table(file)
        found = find_header(table, self.spec, self.required)
        if found is None:
            raise ParseFailedError("The installments header was not found.")
        start, columns = found
        rows: list[RealEstateRow] = []
        seen: set[int] = set()
        skipped = 0
        for raw in table[start + 1 :]:
            if not any(cell.strip() for cell in raw):
                continue
            row = installment_row(raw, columns)
            if row is None or row.number in seen:
                skipped += 1
                continue
            seen.add(row.number)
            rows.append(row)
        if not rows:
            raise ParseFailedError("The file has no usable installment rows.")
        rows.sort(key=lambda row: getattr(row, "number", 0))
        warnings = [f"{skipped} rows were not valid installments and were left out."] * bool(
            skipped
        )
        return _response(self.id, self.version, rows, warnings, "Installments", "installments")


class WorksPaymentsCsv(_CsvParser):
    id = "works-payments-csv"
    spec = PAYMENT_COLUMNS
    required = PAYMENT_REQUIRED

    def parse(self, file: SniffedFile) -> RealEstateParseResponse:
        table = _table(file)
        found = find_header(table, self.spec, self.required)
        if found is None:
            raise ParseFailedError("The payments header was not found.")
        start, columns = found
        rows: list[RealEstateRow] = []
        skipped = corrected = 0
        for raw in table[start + 1 :]:
            if not any(cell.strip() for cell in raw):
                continue
            row, fixed = payment_row(raw, columns)
            corrected += fixed
            if row is None:
                skipped += 1
            else:
                rows.append(row)
        if not rows:
            raise ParseFailedError("The file has no usable payment rows.")
        warnings = []
        if skipped:
            warnings.append(f"{skipped} rows were not valid payments and were left out.")
        if corrected:
            warnings.append(
                f"{corrected} payments marked as paid have no payment date: kept as planned."
            )
        return _response(self.id, self.version, rows, warnings, "Payments", "payments")


def _response(
    parser_id: str,
    version: str,
    rows: list[RealEstateRow],
    warnings: list[str],
    sheet: str,
    label: str,
) -> RealEstateParseResponse:
    return RealEstateParseResponse(
        rows=rows,
        meta=RealEstateMeta(
            parser_id=parser_id,
            parser_version=version,
            row_count=len(rows),
            sheets=[SheetSummary(sheet=sheet, label=label, rows=len(rows), action="import")],
        ),
        warnings=warnings,
    )
