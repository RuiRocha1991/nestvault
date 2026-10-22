"""PDF -> text with the column alignment kept (pdfplumber only: the container has no poppler)."""

import io
import re
from decimal import Decimal

import pdfplumber

from ..errors import UnsupportedFileError

MAX_PAGES = 100
MONTHS = {
    "jan": 1, "fev": 2, "feb": 2, "mar": 3, "abr": 4, "apr": 4, "mai": 5, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "aug": 8, "set": 9, "sep": 9, "out": 10, "oct": 10, "nov": 11, "dez": 12,
    "dec": 12,
}  # fmt: skip
# `1 234,56` / `1.234,56` / `-12,00`, followed by `€`, a space or the end of the line.
EURO = re.compile(r"-?\d{1,3}(?:[ .\u00a0\u202f]\d{3})*,\d{2}(?=\s*€|\s|$)")
_EURO_SIGN = re.compile(EURO.pattern + r"\s*€")
_SPACES = re.compile(r"[\s€\u00a0\u202f]")


def pdf_to_text(data: bytes) -> str:
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return "\f".join(
                (page.extract_text(layout=True) or "") for page in pdf.pages[:MAX_PAGES]
            )
    except Exception as exc:  # pdfplumber/pdfminer raise many types for damaged files
        raise UnsupportedFileError("The PDF could not be read.") from exc


def euro_to_decimal(text: str) -> Decimal:
    return Decimal(_SPACES.sub("", text).replace(".", "").replace(",", "."))


def euro_amounts(text: str) -> list[tuple[int, Decimal]]:
    """(column, value) of every `12,34 €` in the line."""
    return [(m.start(), euro_to_decimal(m.group(0))) for m in _EURO_SIGN.finditer(text)]


def strip_euro(text: str) -> str:
    return _EURO_SIGN.sub("", text)


def money(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.01")), "f")
