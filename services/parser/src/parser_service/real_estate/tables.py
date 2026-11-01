"""What the workbook sheets and the CSV templates share: finding a table by its header names and
turning its cells into rows. Everything is cached values and plain text; nothing is evaluated."""

import re
from collections.abc import Sequence
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from ..helpers import normalize_text, parse_date, parse_num
from .models import InstallmentRow, WorkPaymentRow

Cells = Sequence[Any]
Columns = dict[str, int]

_NOISE = re.compile(r"[.º°ª#:()%]")

# field -> accepted header names, already in `header_key` form (no accents, no dots, upper case).
INSTALLMENT_COLUMNS: dict[str, tuple[str, ...]] = {
    "number": ("N", "NUMERO", "PRESTACAO", "N PRESTACAO", "NUMBER", "INSTALLMENT"),
    "due_date": ("DATA", "DATA VENCIMENTO", "DATA DE VENCIMENTO", "VENCIMENTO", "DUE DATE", "DATE"),
    "capital": ("AMORTIZACAO", "CAPITAL"),
    "interest": ("JUROS", "INTEREST"),
    "life_insurance": ("SEGURO VIDA", "SEGURO DE VIDA", "LIFE INSURANCE"),
    "home_insurance": ("SEGURO CASA", "SEGURO MULTIRISCOS", "HOME INSURANCE"),
    "credit_insurance": ("SEGURO CREDITO", "SEGURO DE CREDITO", "CREDIT INSURANCE"),
    "fees": ("COMISSOES", "COMISSAO", "FEES"),
    "stamp_tax": ("IMPOSTO DE SELO", "IMPOSTO SELO", "STAMP TAX"),
}
INSTALLMENT_REQUIRED = ("number", "due_date", "capital", "interest")
INSTALLMENT_OPTIONAL = (
    "life_insurance",
    "home_insurance",
    "credit_insurance",
    "fees",
    "stamp_tax",
)

PREPAYMENT_COLUMNS: dict[str, tuple[str, ...]] = {
    "date": ("DATA", "DATE"),
    "amount": ("VALOR", "MONTANTE", "AMORTIZACAO", "CAPITAL", "AMOUNT"),
    "fee": ("COMISSAO", "COMISSOES", "FEE"),
}
WORK_COLUMNS: dict[str, tuple[str, ...]] = {
    "name": ("OBRA", "PROJETO", "NOME", "PROJECT", "NAME"),
    "supplier": ("FORNECEDOR", "SUPPLIER"),
    "budget": ("ORCAMENTO", "BUDGET", "VALOR"),
    "deposit": ("ENTRADA", "SINAL", "DEPOSIT"),
    "status": ("ESTADO", "STATUS"),
    "start": ("INICIO", "DATA INICIO", "START"),
    "end": ("FIM PREVISTO", "FIM", "PLANNED END", "END"),
}
PAYMENT_COLUMNS: dict[str, tuple[str, ...]] = {
    "work": ("OBRA", "PROJETO", "PROJECT"),
    "description": ("DESCRICAO", "FASE", "DESCRIPTION", "PHASE"),
    "amount": ("VALOR", "MONTANTE", "AMOUNT"),
    "planned": ("DATA PREVISTA", "PREVISTA", "PLANNED DATE"),
    "paid": ("DATA PAGAMENTO", "DATA DE PAGAMENTO", "PAGO EM", "PAID DATE"),
    "status": ("ESTADO", "STATUS"),
}
INFLATION_COLUMNS: dict[str, tuple[str, ...]] = {
    "year": ("ANO", "YEAR"),
    "rate": ("IPC", "TAXA", "INFLACAO", "INFLATION", "CPI"),
}

_WORK_STATUS = {
    "PLANEADA": "planned",
    "PLANEADO": "planned",
    "PLANNED": "planned",
    "EM CURSO": "in_progress",
    "EM PROGRESSO": "in_progress",
    "IN PROGRESS": "in_progress",
    "CONCLUIDA": "done",
    "CONCLUIDO": "done",
    "PAGA": "done",
    "PAGO": "done",
    "DONE": "done",
}


def header_key(value: object) -> str:
    """A header cell as a matching key: `Seguro Crédito` and `seguro credito` are the same."""
    if value is None:
        return ""
    return " ".join(_NOISE.sub(" ", normalize_text(str(value))).split())


def find_header(
    rows: Sequence[Cells], spec: dict[str, tuple[str, ...]], required: Sequence[str]
) -> tuple[int, Columns] | None:
    """The first row that names every required column, with the column of each field it names."""
    for index, row in enumerate(rows):
        keys = [header_key(cell) for cell in row]
        columns: Columns = {}
        for field, names in spec.items():
            for position, key in enumerate(keys):
                if key in names and position not in columns.values():
                    columns[field] = position
                    break
        if all(field in columns for field in required):
            return index, columns
    return None


def at(row: Cells, columns: Columns, field: str) -> Any:
    position = columns.get(field)
    return row[position] if position is not None and position < len(row) else None


def text_of(cell: object) -> str | None:
    if cell is None or isinstance(cell, bool):
        return None
    value = " ".join(str(cell).split())
    return value or None


def date_of(cell: object) -> str | None:
    if isinstance(cell, datetime):
        return cell.date().isoformat()
    if isinstance(cell, date):
        return cell.isoformat()
    if isinstance(cell, int | float):
        return parse_date(cell)
    return parse_date(text_of(cell))


def money_of(cell: object) -> str | None:
    return parse_num(cell if isinstance(cell, int | float | str) else text_of(cell))


def int_of(cell: object) -> int | None:
    number = money_of(cell)
    if number is None:
        return None
    value = Decimal(number)
    return int(value) if value == value.to_integral_value() else None


def installment_row(row: Cells, columns: Columns) -> InstallmentRow | None:
    """The installment of a row, or None when it is not one (a blank line, a totals line, a cell
    whose formula has no cached value)."""
    number = int_of(at(row, columns, "number"))
    due = date_of(at(row, columns, "due_date"))
    capital = money_of(at(row, columns, "capital"))
    interest = money_of(at(row, columns, "interest"))
    if number is None or not 1 <= number <= 600 or due is None:
        return None
    if capital is None or interest is None:
        return None
    parts = {field: money_of(at(row, columns, field)) or "0" for field in INSTALLMENT_OPTIONAL}
    return InstallmentRow(
        kind="installment",
        number=number,
        due_date=due,
        capital=capital,
        interest=interest,
        **parts,
    )


def work_status(cell: object) -> str:
    return _WORK_STATUS.get(header_key(cell), "planned")


def payment_row(row: Cells, columns: Columns) -> tuple[WorkPaymentRow | None, bool]:
    """The payment phase of a row and whether its status had to be corrected (marked paid without
    any date: it stays planned, because a paid phase needs the date it was paid)."""
    work = text_of(at(row, columns, "work"))
    description = text_of(at(row, columns, "description"))
    amount = money_of(at(row, columns, "amount"))
    if work is None or description is None or amount is None or Decimal(amount) <= 0:
        return None, False
    planned = date_of(at(row, columns, "planned"))
    paid = date_of(at(row, columns, "paid"))
    said_paid = header_key(at(row, columns, "status")) in {"PAGO", "PAGA", "PAID"}
    corrected = said_paid and paid is None
    return (
        WorkPaymentRow(
            kind="work_payment",
            work=work,
            description=description,
            amount=amount,
            planned_date=planned,
            paid_date=paid,
            status="paid" if paid else "planned",
        ),
        corrected,
    )
