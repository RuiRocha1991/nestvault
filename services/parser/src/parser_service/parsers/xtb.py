"""XTB account report (xlsx). Port of `xtbParse` / `xtbBuild` in the v28 prototype.

Sheets: `Cash Operations` (every movement, with the XTB operation id), `Open Positions` (current
prices). One row per operation, so dividends, the tax withheld on them and later tax refunds stay
separate rows that share symbol and date (the import groups them). Amounts are the account's cash
flow: buys and tax are negative, dividends, refunds, interest and sales positive.
"""

import io
import re
import warnings
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import openpyxl

from ..errors import ParseFailedError, UnsupportedFileError
from ..helpers import parse_num
from ..models import BrokerRow, ParseMeta, ParseResponse, ParserKind, PriceEntry
from ..sniff import SniffedFile

CASH_SHEET = "Cash Operations"
POSITIONS_SHEET = "Open Positions"
_TRADE = re.compile(r"\b(?:OPEN|CLOSE)\s+(?:BUY|SELL)\s+([\d.]+)(?:/[\d.]+)?\s*@\s*([\d.]+)", re.I)
_CURRENCY = re.compile(r"^[A-Z]{3}$")


class XtbXlsx:
    id = "xtb-xlsx"
    kind: ParserKind = "broker"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "xlsx" or CASH_SHEET not in file.sheet_names:
            return 0.0
        head = file.header_rows.get(CASH_SHEET, [])
        has_table = any(
            row and row[0] == "Type" and "Amount" in row and "ID" in row for row in head
        )
        return (
            0.95 if has_table and POSITIONS_SHEET in file.sheet_names else 0.7 if has_table else 0.5
        )

    def parse(self, file: SniffedFile) -> ParseResponse:
        workbook = _open(file.data)
        if CASH_SHEET not in workbook.sheetnames:
            raise ParseFailedError('The "Cash Operations" sheet was not found.')
        cash = _rows(workbook[CASH_SHEET])
        header_at = next(
            (i for i, r in enumerate(cash) if r[:1] == ["Type"] and "Amount" in r), None
        )
        if header_at is None:
            raise ParseFailedError('The "Cash Operations" table was not found.')
        header = cash[header_at]
        column = {name: header.index(name) for name in header if isinstance(name, str)}
        for needed in ("Amount", "Time", "ID"):
            if needed not in column:
                raise ParseFailedError(f'The "{needed}" column was not found.')
        account = next((str(r[1]) for r in cash if r[:1] == ["Account number"] and r[1]), None)
        positions = (
            _rows(workbook[POSITIONS_SHEET]) if POSITIONS_SHEET in workbook.sheetnames else []
        )
        currency, as_of = _currency_and_date(positions)
        warnings_out: list[str] = []
        if currency is None:
            currency = "EUR"
            warnings_out.append("The account currency is not stated: confirm it in the preview.")

        rows: list[BrokerRow] = []
        total = Decimal(0)
        file_total: Decimal | None = None
        ignored = 0
        for raw in cash[header_at + 1 :]:
            kind = _text(_at(raw, column, "Type"))
            if not kind:
                continue
            amount = _dec(_at(raw, column, "Amount"))
            if kind == "Total":
                file_total = amount
                continue
            day = _day(_at(raw, column, "Time"))
            if amount is None or day is None:
                ignored += 1
                continue
            total += amount
            row = _row(kind, raw, column, amount, day, currency)
            if row is None:
                ignored += 1
                continue
            rows.append(row)
        if ignored:
            warnings_out.append(f"{ignored} operations of an unknown type were not imported.")
        if not rows:
            raise ParseFailedError("No operations were found in this report.")
        reconciled = None if file_total is None else total == file_total and not ignored
        if reconciled is False:
            warnings_out.append("The operations do not add up to the report total.")
        prices = _prices(positions, column_names=None, currency=currency, as_of=as_of)
        return ParseResponse(
            rows=list(rows),
            meta=ParseMeta(
                parser_id=self.id,
                parser_version=self.version,
                row_count=len(rows),
                closing_balance=None if file_total is None else _plain(file_total),
                reconciled=reconciled,
                account_hint=account,
            ),
            warnings=warnings_out,
            prices=prices,
        )


def _row(
    kind: str,
    raw: list[Any],
    column: dict[str, int],
    amount: Decimal,
    day: str,
    currency: str,
) -> BrokerRow | None:
    lowered = kind.lower()
    comment = _text(_at(raw, column, "Comment"))
    symbol = _text(_at(raw, column, "Ticker")).upper() or None
    name = _text(_at(raw, column, "Instrument")) or None
    external_id = "xtb:" + _text(_at(raw, column, "ID"))
    common: dict[str, Any] = {
        "kind": "broker",
        "date": day,
        "amount": _plain(amount),
        "currency": currency,
        "external_id": external_id,
    }
    trade = _TRADE.search(comment)
    if re.search(r"purchase|sale", lowered) or trade:
        if not trade or not symbol:
            return None
        price = Decimal(trade[2])
        if price <= 0:
            return None
        quantity = Decimal(trade[1]) if Decimal(trade[1]) > 0 else abs(amount) / price
        return BrokerRow(
            type="buy" if amount < 0 else "sell",
            symbol=symbol,
            name=name,
            quantity=_plain(quantity),
            price=_plain(price),
            **common,
        )
    if lowered.startswith("dividend"):
        return BrokerRow(type="dividend", symbol=symbol, name=name, **common)
    if "withholding" in lowered:
        return BrokerRow(type="tax" if amount < 0 else "refund", symbol=symbol, name=name, **common)
    if "free funds interest tax" in lowered:
        return BrokerRow(type="tax", **common)
    if "free funds interest" in lowered:
        return BrokerRow(type="interest", **common)
    if re.search(r"transfer|deposit|withdraw", lowered):
        return BrokerRow(type="deposit" if amount > 0 else "withdrawal", **common)
    if re.search(r"fee|commission", lowered):
        return BrokerRow(type="fee", symbol=symbol, name=name, **common)
    return None


def _prices(
    positions: list[list[Any]], *, column_names: None, currency: str, as_of: str | None
) -> list[PriceEntry]:
    """Current price of every open position (the `Open Positions` table)."""
    header_at = next(
        (i for i, r in enumerate(positions) if r[1:2] == ["Instrument/Position"]), None
    )
    if header_at is None or as_of is None:
        return []
    header = positions[header_at]
    ticker, price = header.index("Ticker"), header.index("Current price")
    out: dict[str, PriceEntry] = {}
    for row in positions[header_at + 1 :]:
        symbol = _text(row[ticker] if ticker < len(row) else None).upper()
        value = _dec(row[price] if price < len(row) else None)
        if symbol and value is not None and value > 0:
            out[symbol] = PriceEntry(
                symbol=symbol, date=as_of, price=_plain(value), currency=currency
            )
    return list(out.values())


def _currency_and_date(positions: list[list[Any]]) -> tuple[str | None, str | None]:
    currency = next(
        (
            str(r[3]).upper()
            for r in positions
            if r[1:2] == ["Open position value"]
            and len(r) > 3
            and _CURRENCY.match(str(r[3]).upper())
        ),
        None,
    )
    as_of_cell = next((r[1] for r in positions if r[:1] and "Data as of" in str(r[0])), None)
    return currency, _day(as_of_cell)


def _open(data: bytes) -> openpyxl.Workbook:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    except Exception as exc:  # openpyxl raises many types for damaged files
        raise UnsupportedFileError("The workbook could not be opened.") from exc


def _rows(sheet: Any) -> list[list[Any]]:
    return [list(r) for r in sheet.iter_rows(values_only=True)]


def _at(row: list[Any], column: dict[str, int], name: str) -> Any:
    index = column.get(name)
    return row[index] if index is not None and index < len(row) else None


def _text(value: object) -> str:
    return "" if value is None else str(value).strip()


def _dec(value: object) -> Decimal | None:
    parsed = parse_num(value if isinstance(value, str | int | float) else None)
    return None if parsed is None else Decimal(parsed)


def _day(value: object) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def _plain(value: Decimal) -> str:
    return format(value.normalize(), "f") if value != 0 else "0"
