"""Fallback for any PDF statement with one movement per line:
`dd-mm-yyyy description value balance`. Port of `parse_generico` in
`docs/tools/extrato_para_csv.py`. Low confidence on purpose: a named parser always outranks it,
and the user is asked to confirm the preview."""

import re
from decimal import Decimal

from ..errors import ParseFailedError
from ..helpers import parse_date
from ..models import BankRow, ParseMeta, ParseResponse, ParserKind
from ..sniff import SniffedFile
from .pdf_text import EURO, euro_to_decimal, money, pdf_to_text

_LINE = re.compile(r"^\s*(\d{2}[-/.]\d{2}[-/.]\d{2,4})\s+(?:\d{2}[-/.]\d{2}[-/.]\d{2,4}\s+)?(.*)$")
_TOLERANCE = Decimal("0.011")
MIN_LINES_TO_DETECT = 3


def _matches(line: str) -> re.Match[str] | None:
    match = _LINE.match(line)
    return match if match and EURO.search(match[2]) else None


class GenericPdfLines:
    id = "generic-pdf-lines"
    kind: ParserKind = "bank"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "pdf":
            return 0.0
        hits = sum(1 for line in file.pdf_lines if _matches(line))
        return 0.5 if hits >= MIN_LINES_TO_DETECT else 0.0

    def parse(self, file: SniffedFile) -> ParseResponse:
        rows: list[BankRow] = []
        previous: Decimal | None = None
        closing: Decimal | None = None
        warnings: list[str] = []
        for line in pdf_to_text(file.data).splitlines():
            match = _matches(line)
            if not match:
                continue
            iso = parse_date(match[1])
            values = [(m.start(), euro_to_decimal(m.group(0))) for m in EURO.finditer(match[2])]
            if iso is None:
                warnings.append("A line with an invalid date was skipped.")
                continue
            amount = values[-2][1] if len(values) >= 2 else values[-1][1]
            balance = values[-1][1] if len(values) >= 2 else None
            if balance is not None and previous is not None:
                delta = balance - previous
                if abs(abs(delta) - abs(amount)) < _TOLERANCE:
                    amount = delta
            if balance is not None:
                previous = closing = balance
            description = re.sub(r"\s+", " ", EURO.sub("", match[2]).replace("€", "")).strip()
            rows.append(
                BankRow(
                    kind="bank",
                    date=iso,
                    description=description[:500],
                    amount=money(amount),
                    balance=None if balance is None else money(balance),
                )
            )
        if not rows:
            raise ParseFailedError("No movements were found in this PDF.")
        return ParseResponse(
            rows=list(rows),
            meta=ParseMeta(
                parser_id=self.id,
                parser_version=self.version,
                row_count=len(rows),
                closing_balance=None if closing is None else money(closing),
            ),
            warnings=warnings,
        )
