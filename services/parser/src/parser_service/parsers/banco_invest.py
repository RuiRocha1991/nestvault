"""Banco Invest "Posição Actual" workbook (xlsx/xlsm). Port of `docs/tools/bancoinvest_para_csv.py`.

Section "Investimentos (por lote)": every lot of every holder becomes a buy on the holder's
sub-account (the holder's first name). The summary table at the top (units per holder, quote) is
what the lots are reconciled against, and the quote becomes a price entry.
"""

import hashlib
import io
import re
import warnings
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import openpyxl

from ..errors import ParseFailedError, UnsupportedFileError
from ..helpers import normalize_text, parse_date, parse_num
from ..models import BrokerRow, ParseMeta, ParseResponse, ParserKind, PriceEntry
from ..sniff import SniffedFile

# Funds whose ticker the app already knows; any other fund keeps its (normalised) name.
KNOWN_FUNDS = {"INVEST TENDENCIAS GLOBAIS": "INVTG"}
_TITLE_SUFFIX = re.compile(r"\s*-\s*Posi[cç][aã]o Actual\s*$", re.IGNORECASE)
_QUANTITY_TOLERANCE = Decimal("0.001")
# `Subscrição`, `Subs / T` (subscription by transfer), `Resgate`, ... by the start of the word.
_SIDES = (("SUBS", "buy"), ("COMPRA", "buy"), ("RESG", "sell"), ("VENDA", "sell"))


class BancoInvestXlsx:
    id = "banco-invest-xlsx"
    kind: ParserKind = "broker"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "xlsx":
            return 0.0
        best = 0.0
        for rows in file.header_rows.values():
            first = normalize_text(str(rows[0][0])) if rows and rows[0] and rows[0][0] else ""
            if "POSICAO ACTUAL" not in first:
                continue
            has_summary = any(
                len(row) > 2
                and normalize_text(str(row[0])) == "TITULAR"
                and normalize_text(str(row[2])) == "QTD"
                for row in rows
            )
            best = max(best, 0.95 if has_summary else 0.6)
        return best

    def parse(self, file: SniffedFile) -> ParseResponse:
        report = _read(file.data)
        if not report.lots:
            raise ParseFailedError("No lots were found in this workbook.")
        symbol = KNOWN_FUNDS.get(normalize_text(report.fund), report.fund)
        warnings_out: list[str] = []
        if symbol == report.fund:
            warnings_out.append("The fund ticker is not known: confirm it in the preview.")
        seen: dict[str, int] = {}
        rows: list[BrokerRow] = []
        for lot in report.lots:
            side = _side(lot.kind)
            if side is None:
                warnings_out.append("A lot with an unknown type was skipped.")
                continue
            first_name = lot.holder.split()[0].capitalize()
            holder_key = normalize_text(lot.holder)
            key = f"{report.account}|{holder_key}|{lot.date}|{lot.quantity}|{lot.price}"
            seen[key] = seen.get(key, 0) + 1
            rows.append(
                BrokerRow(
                    kind="broker",
                    date=lot.date,
                    type=side,
                    symbol=symbol,
                    quantity=_plain(lot.quantity),
                    price=_plain(lot.price),
                    amount=_plain(_cash(side, lot.quantity * lot.price)),
                    currency=report.currency,
                    holder=first_name,
                    external_id="bi-"
                    + hashlib.sha256(f"{key}|{seen[key]}".encode()).hexdigest()[:24],
                )
            )
        reconciled = _reconcile(report, rows, warnings_out)
        prices = (
            [
                PriceEntry(
                    symbol=symbol,
                    date=report.report_date,
                    price=_plain(report.quote),
                    currency=report.currency,
                )
            ]
            if report.quote is not None
            else []
        )
        return ParseResponse(
            rows=list(rows),
            meta=ParseMeta(
                parser_id=self.id,
                parser_version=self.version,
                row_count=len(rows),
                reconciled=reconciled,
            ),
            warnings=warnings_out,
            prices=prices,
        )


class _Lot:
    __slots__ = ("date", "holder", "kind", "price", "quantity")

    def __init__(self, holder: str, kind: str, day: str, quantity: Decimal, price: Decimal) -> None:
        self.holder, self.kind, self.date, self.quantity, self.price = (
            holder, kind, day, quantity, price,
        )  # fmt: skip


class _Report:
    def __init__(self) -> None:
        self.fund = "Fundo Banco Invest"
        self.report_date = date.today().isoformat()
        self.account = ""
        self.currency = "EUR"
        self.quote: Decimal | None = None
        self.summary: dict[str, Decimal] = {}  # normalised holder -> units
        self.lots: list[_Lot] = []


def _side(kind: str) -> str | None:
    key = normalize_text(kind)
    return next((side for prefix, side in _SIDES if key.startswith(prefix)), None)


def _plain(value: Decimal) -> str:
    return format(value.normalize(), "f") if value != 0 else "0"


def _cash(side: str, value: Decimal) -> Decimal:
    """Money leaving (buy) is negative, money coming in (sell) is positive."""
    value = value.quantize(Decimal("0.0001"))
    return -value if side == "buy" else value


def _dec(value: object) -> Decimal | None:
    parsed = parse_num(value if isinstance(value, str | int | float) else None)
    return None if parsed is None else Decimal(parsed)


def _day(value: object) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return parse_date(value) if isinstance(value, str | int | float) else None


def _read(data: bytes) -> _Report:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            workbook = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except Exception as exc:  # openpyxl raises many types for damaged files
        raise UnsupportedFileError("The workbook could not be opened.") from exc
    sheet = workbook.worksheets[0]
    lines: list[list[Any]] = [
        list(row)
        for row in sheet.iter_rows(values_only=True)
        if any(cell not in (None, "") for cell in row)
    ]
    if len(lines) < 3:
        raise ParseFailedError("This workbook is not a Banco Invest position.")
    report = _Report()
    title = _TITLE_SUFFIX.sub("", str(lines[0][0] or "")).strip()
    report.fund = title or report.fund
    report.report_date = _day(lines[1][0]) or report.report_date
    i = 0
    while i < len(lines):
        label = normalize_text(str(lines[i][0] or ""))
        if label == "CONTA" and i + 1 < len(lines):
            report.account = str(lines[i + 1][0]).replace("\xa0", " ").strip()
        elif label == "MOEDA" and i + 1 < len(lines):
            report.currency = str(lines[i + 1][0]).strip().upper()[:3] or "EUR"
        elif label == "TITULAR" and len(lines[i]) > 2 and normalize_text(str(lines[i][2])) == "QTD":
            i = _read_summary(lines, i + 1, report)
            continue
        elif label.startswith("INVESTIMENTOS (POR LOTE)"):
            i = _read_lots(lines, i + 1, report)
            continue
        i += 1
    return report


def _read_summary(lines: list[list[Any]], start: int, report: _Report) -> int:
    j = start
    while j < len(lines) and isinstance(lines[j][2], int | float):
        row = lines[j]
        report.summary[normalize_text(str(row[0]))] = _dec(row[2]) or Decimal(0)
        if report.quote is None and len(row) > 4:
            report.quote = _dec(row[4])
        j += 1
    return j


def _read_lots(lines: list[list[Any]], start: int, report: _Report) -> int:
    holder: str | None = None
    j = start
    while j < len(lines):
        row = lines[j]
        first = normalize_text(str(row[0] or ""))
        if first in report.summary:
            holder = str(row[0]).strip()
        elif first == "TIPO":
            pass
        elif first.startswith("WWW."):
            break
        elif holder and len(row) > 3 and _day(row[1]) and isinstance(row[2], int | float):
            quantity, price = _dec(row[2]), _dec(row[3])
            day = _day(row[1])
            if quantity is not None and price is not None and day is not None:
                report.lots.append(_Lot(holder, str(row[0]).strip(), day, quantity, price))
        j += 1
    return j


def _reconcile(report: _Report, rows: list[BrokerRow], warnings_out: list[str]) -> bool | None:
    if not report.summary:
        return None
    units: dict[str, Decimal] = {}
    for lot in report.lots:
        sign = 1 if _side(lot.kind) == "buy" else -1
        units[normalize_text(lot.holder)] = (
            units.get(normalize_text(lot.holder), Decimal(0)) + sign * lot.quantity
        )
    ok = True
    for holder, expected in report.summary.items():
        if abs(units.get(holder, Decimal(0)) - expected) >= _QUANTITY_TOLERANCE:
            ok = False
            warnings_out.append("The lots of a holder do not add up to the bank's quantity.")
    return ok
