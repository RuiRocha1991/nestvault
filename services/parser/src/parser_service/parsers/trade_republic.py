"""Trade Republic account statement (PDF, pt-PT). Port of `parse_trade_republic` in
`docs/tools/extrato_para_csv.py`, with Decimal amounts and no `pdftotext` binary.

Each movement is a block of 2-3 lines that ends with its year line:

    19 nov.                        Depósito aceite: … para
                Transferência                                   100,00 €              100,00 €
    2024                           DE55502109007023130518

A long type wraps over the date line and the year line (`Transação com` / `cartão`).

Columns: DATA | TIPO | DESCRIÇÃO | ENTRADA DE DINHEIRO | SAÍDA DE DINHEIRO | SALDO (their position
changes from page to page, so it is read from each page header). The sign comes from the balance
change; the column is the fallback.
"""

import re
from decimal import Decimal

from ..errors import ParseFailedError
from ..helpers import normalize_text
from ..models import BankRow, BankRowType, ParseMeta, ParseResponse, ParserKind
from ..sniff import SniffedFile
from .pdf_text import MONTHS, euro_amounts, euro_to_decimal, money, pdf_to_text, strip_euro

_OPENING = re.compile(r"Conta corrente\s+(-?\d[\d .\u00a0\u202f]*,\d{2})\s*€")
_DAY_MONTH = re.compile(r"^\s*(\d{1,2}) (\w{3})\.")
_YEAR = re.compile(r"^\d{4}$")
_HEADER = re.compile(r"^\s*DATA\s+TIPO\s+DESCRI")
_GAP = re.compile(r"\s{2,}")
MAX_BLOCK_LINES = 8
DASH = "\u2013"
_TOLERANCE = Decimal("0.011")

# Keywords of the `TIPO` column (normalised), first match wins.
_TYPES: tuple[tuple[tuple[str, ...], BankRowType], ...] = (
    (("JUROS", "INTEREST"), "interest"),
    (("COMISSAO",), "fee"),
    (("DIVIDENDO", "RENDIMENTO"), "dividend"),
    (("TRANSACAO COM", "CARTAO", "CARD"), "card"),
    (("NEGOCIACAO", "COMPRA", "VENDA", "SAVINGS PLAN", "PLANO DE POUPANCA"), "trade"),
    (("TRANSFERENCIA", "DEPOSITO", "LEVANTAMENTO"), "transfer"),
)


def classify(type_text: str) -> BankRowType:
    key = normalize_text(type_text)
    for words, row_type in _TYPES:
        if any(word in key for word in words):
            return row_type
    return "other"


# Words the type column starts with. They are the only way to tell the type from the description
# on the middle line, where the two are a single space apart.
_TYPE_WORDS = ("Transferência", "Juros", "Comissão", "Negociação", "Rendimento", "Dividendo")


class TradeRepublicPdf:
    id = "trade-republic-pdf"
    kind: ParserKind = "bank"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "pdf":
            return 0.0
        text = normalize_text(" ".join(file.pdf_lines))
        if "TRADE REPUBLIC" not in text:
            return 0.0
        return 0.95 if "TRANSACOES" in text or "CONTA CORRENTE" in text else 0.8

    def parse(self, file: SniffedFile) -> ParseResponse:
        text = pdf_to_text(file.data)
        if "TRADE REPUBLIC" not in text.upper():
            raise ParseFailedError("This is not a Trade Republic statement.")
        opening_match = _OPENING.search(text)
        opening = euro_to_decimal(opening_match.group(1)) if opening_match else None
        movements, warnings = parse_movements(text, opening)
        if not movements:
            raise ParseFailedError("No movements were found in this statement.")
        rows = [
            BankRow(
                kind="bank",
                date=m.date,
                description=m.description[:500],
                amount=money(m.amount),
                balance=money(m.balance),
                type=m.type,
            )
            for m in movements
        ]
        total = sum((m.amount for m in movements), Decimal(0))
        closing = movements[-1].balance
        reconciled = None if opening is None else opening + total == closing
        if reconciled is False:
            warnings.append("The movements do not add up to the closing balance.")
        return ParseResponse(
            rows=list(rows),
            meta=ParseMeta(
                parser_id=self.id,
                parser_version=self.version,
                row_count=len(rows),
                opening_balance=None if opening is None else money(opening),
                closing_balance=money(closing),
                reconciled=reconciled,
            ),
            warnings=warnings,
        )


class Movement:
    __slots__ = ("amount", "balance", "date", "description", "type", "type_text")

    def __init__(
        self, date: str, type_text: str, description: str, amount: Decimal, balance: Decimal
    ) -> None:
        self.date = date
        self.type_text = type_text
        self.description = description
        self.amount = amount
        self.balance = balance
        self.type = classify(type_text)


def parse_movements(text: str, opening: Decimal | None) -> tuple[list[Movement], list[str]]:
    """Movements in file order. Blocks that cannot be read become warnings, never silent drops."""
    start, end = text.find("TRANSAÇÕES"), text.find("SÍNTESE DO BALANÇO")
    body = text[start if start >= 0 else 0 : end if end > 0 else len(text)]
    lines = body.splitlines()
    previous = opening if opening is not None else Decimal(0)
    col_type = col_desc = col_in = col_out = None
    movements: list[Movement] = []
    warnings: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if "ENTRADA DE" in line and "SAÍDA DE" in line:
            col_in, col_out = line.index("ENTRADA DE"), line.index("SAÍDA DE")
        if _HEADER.match(line):
            col_type, col_desc = line.index("TIPO"), line.index("DESCRI")
        day_month = _DAY_MONTH.match(line)
        if not day_month or col_type is None or col_desc is None:
            i += 1
            continue
        # A movement ends at its year line: what follows is a page footer or the next movement.
        block = [line]
        i += 1
        while i < len(lines) and len(block) < MAX_BLOCK_LINES:
            if _DAY_MONTH.match(lines[i]) or _HEADER.match(lines[i]):
                break
            if lines[i].strip():
                block.append(lines[i])
                if _year_of(lines[i], col_type) is not None:
                    i += 1
                    break
            i += 1
        movement = _read_block(block, previous, (col_type, col_desc, col_in, col_out))
        if movement is None:
            warnings.append(f"A movement on {day_month[1]} {day_month[2]} could not be read.")
            continue
        previous = movement.balance
        movements.append(movement)
    return movements, warnings


def _year_of(line: str, col_type: int) -> int | None:
    part = line[:col_type].strip()
    return int(part) if _YEAR.match(part) else None


def _split_type(fragment: str, in_description_column: bool) -> tuple[str, str]:
    """`Transferência PayOut to transit` -> (`Transferência`, `PayOut to transit`). A fragment that
    starts in the description column is all description (the type wrapped onto the other lines)."""
    key = normalize_text(fragment)
    for word in _TYPE_WORDS:
        if key.startswith(normalize_text(word)):
            return fragment[: len(word)], fragment[len(word) :].strip()
    if in_description_column:
        return "", fragment
    head, *rest = _GAP.split(fragment, maxsplit=1)
    return head, rest[0] if rest else ""


def _read_block(
    block: list[str],
    previous: Decimal,
    columns: tuple[int, int, int | None, int | None],
) -> Movement | None:
    col_type, col_desc, col_in, col_out = columns
    day_month = _DAY_MONTH.match(block[0])
    year: int | None = None
    type_parts: list[str] = []
    desc_parts: list[str] = []
    values: list[tuple[int, Decimal]] = []
    for number, raw in enumerate(block):
        part = raw
        if number == 0 and day_month:  # blank the date so it cannot leak into the type column
            part = " " * day_month.end() + raw[day_month.end() :]
        found = _year_of(raw, col_type)
        if found is not None:
            year = found
            part = " " * (len(raw[:col_type])) + raw[col_type:]
        amounts = euro_amounts(part)
        values.extend(amounts)
        fragment = strip_euro(part).strip()
        if not fragment:
            continue
        begin = len(part) - len(part.lstrip())
        if amounts:  # the middle line: type, then description
            type_text, desc_text = _split_type(fragment, begin >= col_desc)
            if type_text:
                type_parts.append(type_text)
            if desc_text:
                desc_parts.append(desc_text)
        elif begin < col_desc:
            type_parts.append(fragment)
        else:
            desc_parts.append(fragment)
    month = MONTHS.get(day_month[2].lower()[:3]) if day_month else None
    if year is None or month is None or day_month is None or len(values) < 2:
        return None
    column, amount = values[0]
    balance = values[-1][1]
    delta = balance - previous
    if abs(abs(delta) - amount) < _TOLERANCE:
        signed = delta
    else:
        outgoing = (
            col_in is not None
            and col_out is not None
            and abs(column - col_out) < abs(column - col_in)
        )
        signed = -amount if outgoing else amount
    type_text = " ".join(type_parts)
    description = re.sub(r"\s+", " ", " ".join(desc_parts))
    full = (
        f"{type_text} {DASH} {description}"
        if type_text and description
        else type_text or description
    )
    date = f"{year:04d}-{month:02d}-{int(day_month[1]):02d}"
    return Movement(date, type_text, full, signed, balance)
