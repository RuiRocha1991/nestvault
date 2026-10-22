"""Reading dates and numbers exactly as the spec says. The final cleaning goes through the shared
`parse_num` / `parse_date` helpers, so the engine and the code parsers agree on edge cases."""

import re
from datetime import date, datetime
from decimal import Decimal

from ..helpers import parse_date, parse_num
from .spec import DateFormat, Formats

_TOKENS = {
    "dd": r"(?P<d>\d{1,2})",
    "mm": r"(?P<m>\d{1,2})",
    "yyyy": r"(?P<y>\d{4})",
    "yy": r"(?P<y>\d{2})",
}
_DATE_PATTERNS: dict[str, re.Pattern[str]] = {}


def _date_pattern(fmt: DateFormat) -> re.Pattern[str]:
    if fmt not in _DATE_PATTERNS:
        parts = re.split(r"([-/.])", fmt)
        body = "".join(_TOKENS.get(p, re.escape(p)) for p in parts)
        _DATE_PATTERNS[fmt] = re.compile(rf"^\s*{body}(?!\d)")
    return _DATE_PATTERNS[fmt]


def read_date(cell: object, fmt: DateFormat) -> str | None:
    """ISO date from a cell: real dates and Excel serials as they are, text by the spec format."""
    if isinstance(cell, datetime):
        return cell.date().isoformat()
    if isinstance(cell, date):
        return cell.isoformat()
    if isinstance(cell, int | float) and not isinstance(cell, bool):
        return parse_date(cell)
    if not isinstance(cell, str):
        return None
    match = _date_pattern(fmt).match(cell)
    if not match:
        return None
    year = match["y"]
    iso = f"{'20' + year if len(year) == 2 else year}-{int(match['m']):02d}-{int(match['d']):02d}"
    return parse_date(iso)


def _well_formed(text: str, formats: Formats) -> bool:
    """Digits, grouped in threes by the thousands mark (if any), one decimal mark, optional sign."""
    thousands = re.escape(formats.thousands) if formats.thousands else ""
    decimal = re.escape(formats.decimal)
    integer = rf"(?:\d{{1,3}}(?:{thousands}\d{{3}})+|\d+)" if thousands else r"\d+"
    pattern = rf"^[+-]?(?:{integer})?(?:{decimal}\d+)?-?$"
    return bool(re.fullmatch(pattern, text)) and any(c.isdigit() for c in text)


def read_number(cell: object, formats: Formats) -> Decimal | None:
    """A decimal from a cell. Numbers are taken as they are; text follows the spec's separators."""
    if isinstance(cell, bool) or cell is None:
        return None
    if isinstance(cell, int | float):
        parsed = parse_num(cell)
        return None if parsed is None else Decimal(parsed)
    if not isinstance(cell, str):
        return None
    text = cell.strip().replace("\u00a0", " ")
    negative = False
    if formats.negative == "parentheses" and text.startswith("(") and text.endswith(")"):
        negative, text = True, text[1:-1]
    text = re.sub(r"[\s€]", "", text)
    if not _well_formed(text, formats):
        return None
    if formats.thousands:
        text = text.replace(formats.thousands, "")
    if formats.decimal == ",":
        text = text.replace(",", ".")
    parsed = parse_num(text)
    if parsed is None:
        return None
    value = Decimal(parsed)
    return -value if negative else value
