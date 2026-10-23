"""Generic bank csv: when no spec matches, guess a column mapping for the user to confirm.

The proposal is a complete `ImportSpec` plus the header cells and a preview, so the screen can
show what would be imported and let the user change a column. The confirmed spec is saved per
account (by the app, as a pool-local spec) and sent back with `/parse-spec` on the next import.
"""

import hashlib
import re
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from ..errors import ParseFailedError, UnsupportedFileError
from ..models import ParseResponse
from ..sniff import SniffedFile
from .formats import read_date
from .parser import SpecParser
from .spec import (
    Columns,
    Fingerprint,
    Formats,
    ImportSpec,
    Table,
)
from .table import (
    SCAN_ROWS,
    Rows,
    detect_delimiter,
    find_header,
    guess_columns,
    is_blank,
    read_rows,
)

PREVIEW_ROWS = 20
HeaderCell = Annotated[str, StringConstraints(max_length=100)]


class ProposeResponse(BaseModel):
    """The guessed spec (JSON as `ImportSpec` writes it), the header cells to choose columns from,
    and what the spec would import."""

    model_config = ConfigDict(extra="forbid")

    spec: ImportSpec
    header: Annotated[list[HeaderCell], Field(max_length=200)]
    preview: ParseResponse


_DATE_FORMATS = (
    "dd-mm-yyyy",
    "dd/mm/yyyy",
    "dd.mm.yyyy",
    "yyyy-mm-dd",
    "yyyy/mm/dd",
    "dd-mm-yy",
    "dd/mm/yy",
    "mm/dd/yyyy",
)
_COMMA_DECIMAL = re.compile(r",\d{1,2}$")
_DOT_DECIMAL = re.compile(r"\.\d{1,2}$")


def propose(file: SniffedFile) -> ProposeResponse:
    if file.magic != "csv":
        raise UnsupportedFileError("Column mapping is proposed for csv files.")
    delimiter = detect_delimiter(file.text or "")
    rows = read_rows(file, sheet=None, delimiter=delimiter, encoding=None)
    header_at = find_header(rows)
    if header_at >= len(rows) - 1:
        raise ParseFailedError("No table was found in this file.")
    header = rows[header_at]
    guess = guess_columns(header)
    two_columns = (
        guess["amount"] is None and guess["debit"] is not None and guess["credit"] is not None
    )
    if (
        guess["date"] is None
        or guess["description"] is None
        or (guess["amount"] is None and not two_columns)
    ):
        raise ParseFailedError("The columns of this file could not be guessed.")
    data = [r for r in rows[header_at + 1 : header_at + 1 + SCAN_ROWS] if not is_blank(r)]
    date_format = _guess_date_format(data, guess["date"])
    amount_index = guess["amount"] if guess["amount"] is not None else guess["debit"]
    decimal, thousands = _guess_separators(data, amount_index)

    def name(index: int | None) -> str | None:
        return None if index is None else str(header[index])[:100]

    columns = Columns(
        date=str(name(guess["date"])),
        description=str(name(guess["description"])),
        amount=name(guess["amount"]),
        debit=None if guess["amount"] is not None else name(guess["debit"]),
        credit=None if guess["amount"] is not None else name(guess["credit"]),
        balance=name(guess["balance"]),
    )
    labels = [str(header[i])[:100] for i in range(len(header)) if header[i] not in (None, "")]
    spec = ImportSpec(
        id="generic-csv-" + hashlib.sha256("|".join(labels).encode()).hexdigest()[:12],
        version=1,
        kind="bank",
        fingerprint=Fingerprint(
            type="csv",
            headers=[x for x in (columns.date, columns.description) if x],
            delimiter=delimiter if delimiter in (";", ",", "\t", "|") else None,
        ),
        table=Table(header_row=header_at),
        columns=columns,
        formats=Formats(
            date=date_format,
            decimal=decimal,
            thousands=thousands,
            negative="sign" if guess["amount"] is not None else "debitColumn",
        ),
    )
    preview = SpecParser(spec).parse(file)
    shown = preview.model_copy(update={"rows": preview.rows[:PREVIEW_ROWS]})
    cells = [str(c)[:100] for c in header if c is not None][:200]
    return ProposeResponse(spec=spec, header=cells, preview=shown)


def _guess_date_format(data: Rows, index: int) -> Any:
    def hits(fmt: Any) -> int:
        return sum(1 for r in data if index < len(r) and read_date(r[index], fmt) is not None)

    best = max(_DATE_FORMATS, key=hits)  # ties go to the first, the day-first formats
    if hits(best) == 0:
        raise ParseFailedError("The date format of this file could not be guessed.")
    return best


def _guess_separators(data: Rows, index: int | None) -> tuple[Any, Any]:
    """`1.234,56` -> (",", ".") and `1,234.56` -> (".", ","); with neither mark: pt-PT."""
    comma = dot = 0
    for row in data:
        cell = row[index] if index is not None and index < len(row) else None
        if isinstance(cell, str):
            text = re.sub(r"[\s€()-]", "", cell)
            comma += bool(_COMMA_DECIMAL.search(text))
            dot += bool(_DOT_DECIMAL.search(text))
    if dot > comma:
        return ".", ","
    return ",", "."
