"""Number, date and text helpers. They behave exactly like `parseNum`, `parseDate` and
`normalizeText` in `packages/domain`; `schemas/test-vectors.json` is run by both test suites."""

import re
import unicodedata
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

_STRIP = re.compile(r"\s|€|EUR", re.IGNORECASE)
_PLAIN_NUMBER = re.compile(r"^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$")
_DOTTED_GROUPS = re.compile(r"^[0-9]{1,3}(?:\.[0-9]{3})+$")
_YEAR_FIRST = re.compile(r"^([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})(?![0-9])")
_DAY_FIRST = re.compile(r"^([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{4}|[0-9]{2})(?![0-9])")
_EXCEL_EPOCH = date(1899, 12, 30)
_WHITESPACE = re.compile(r"\s+")


def _plain(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    return "0" if text in ("-0", "") else text


def parse_num(value: str | int | float | None) -> str | None:
    """A number as written in statements -> plain decimal string, or None when it is not one."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        try:
            number = Decimal(repr(value))
        except InvalidOperation:
            return None
        return _plain(number) if number.is_finite() else None

    text = _STRIP.sub("", value)
    if text == "":
        return None

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1]
    if text.endswith("-"):
        negative = True
        text = text[:-1]
    if text.startswith("-"):
        if negative:
            return None
        negative = True
        text = text[1:]
    elif text.startswith("+"):
        text = text[1:]

    last_comma = text.rfind(",")
    last_dot = text.rfind(".")
    if last_comma > -1 and last_dot > -1:
        text = (
            text.replace(".", "").replace(",", ".")
            if last_comma > last_dot
            else text.replace(",", "")
        )
    elif last_comma > -1:
        text = text.replace(",", ".") if last_comma == text.find(",") else text.replace(",", "")
    elif last_dot > -1 and _DOTTED_GROUPS.match(text):
        text = text.replace(".", "")

    if not _PLAIN_NUMBER.match(text):
        return None
    result = _plain(Decimal(text))
    return f"-{result}" if negative and result != "0" else result


def _build(year: str, month: str, day: str) -> str | None:
    try:
        return date(int(year), int(month), int(day)).isoformat()
    except ValueError:
        return None


def parse_date(value: str | int | float | None) -> str | None:
    """`yyyy-mm-dd`, `dd-mm-yyyy`, `dd/mm/yyyy` (also `.`) or an Excel serial -> ISO date."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        if value != value or not 20000 < value < 80000:  # NaN fails the comparison too
            return None
        return (_EXCEL_EPOCH + timedelta(days=int(value // 1))).isoformat()
    text = (value or "").strip()
    first = _YEAR_FIRST.match(text)
    if first:
        return _build(first[1], first[2], first[3])
    second = _DAY_FIRST.match(text)
    if second:
        year = second[3]
        return _build(f"20{year}" if len(year) == 2 else year, second[2], second[1])
    return None


def normalize_text(value: str | None) -> str:
    """Matching key: no accents, upper case, single spaces."""
    decomposed = unicodedata.normalize("NFD", value or "")
    stripped = "".join(c for c in decomposed if not "̀" <= c <= "ͯ")
    return _WHITESPACE.sub(" ", stripped.upper()).strip()
