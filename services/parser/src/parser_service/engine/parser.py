"""Runs an `ImportSpec` against a file. Implements the `Parser` protocol, so a spec is registered,
detected and parsed exactly like a hand-written parser."""

import re
from decimal import Decimal
from typing import Any

from ..config import MIN_SECRET_LENGTH, Settings
from ..errors import ParseFailedError
from ..helpers import normalize_text
from ..limits import compile_pattern, safe_search
from ..models import BankRow, ParseMeta, ParseResponse, ParserKind
from ..sniff import SniffedFile
from .formats import read_date, read_number
from .spec import ImportSpec
from .table import (
    Rows,
    column_index,
    find_header,
    header_matching,
    is_blank,
    read_rows,
)

# Only the regex limits are read from this; the secret is not used by the engine.
ENGINE_LIMITS = Settings(secret="-" * MIN_SECRET_LENGTH)
MIN_COVERAGE = 0.75  # share of the fingerprint headers a file must have to be considered
_TOLERANCE = Decimal("0.005")


def _plain(value: Decimal) -> str:
    text = format(value.quantize(Decimal("0.0001")).normalize(), "f")
    return "0" if text in ("-0", "") else text


class SpecParser:
    kind: ParserKind = "bank"

    def __init__(self, spec: ImportSpec, settings: Settings = ENGINE_LIMITS) -> None:
        self.spec = spec
        self.settings = settings
        self.id = spec.id
        self.version = str(spec.version)
        self._filters = [
            compile_pattern(pattern, settings)
            for pattern in spec.filters.skip_if_description_matches
        ]

    def detect(self, file: SniffedFile) -> float:
        fingerprint = self.spec.fingerprint
        if file.magic != fingerprint.type:
            return 0.0
        if file.magic == "xlsx":
            sheet = fingerprint.sheet or (file.sheet_names[0] if file.sheet_names else None)
            if sheet is None or sheet not in file.sheet_names:
                return 0.0
            head = file.header_rows.get(sheet, [])
        else:
            head = file.header_rows.get("", [])
        wanted = {normalize_text(h) for h in fingerprint.headers}
        best = max(
            (len(wanted & {normalize_text(str(c)) for c in row if c is not None}) for row in head),
            default=0,
        )
        coverage = best / len(wanted)
        if coverage < MIN_COVERAGE:
            return 0.0
        return round(0.5 + 0.45 * (coverage - MIN_COVERAGE) / (1 - MIN_COVERAGE), 4)

    def parse(self, file: SniffedFile) -> ParseResponse:
        spec = self.spec
        rows = read_rows(
            file,
            sheet=spec.fingerprint.sheet,
            delimiter=spec.fingerprint.delimiter,
            encoding=spec.fingerprint.encoding,
        )
        header_at = self._header_row(rows)
        header = rows[header_at]
        columns = self._columns(header)
        out: list[BankRow] = []
        skipped = 0
        for raw in rows[header_at + 1 :]:
            if is_blank(raw):
                if spec.table.stop_at == "empty-row" and out:
                    break
                continue
            row = self._row(raw, columns)
            if row is None:
                if spec.table.stop_at == "no-date" and out and self._date(raw, columns) is None:
                    break
                skipped += 1
                continue
            if self._skipped(row.description):
                continue
            out.append(row)
        if not out:
            raise ParseFailedError("No movements were found in this file.")
        warnings = [f"{skipped} rows were not movements and were skipped."] if skipped else []
        meta = self._meta(out)
        if meta.reconciled is False:
            warnings.append("The balances do not follow from the amounts.")
        return ParseResponse(rows=list(out), meta=meta, warnings=warnings)

    def _header_row(self, rows: Rows) -> int:
        table, fingerprint = self.spec.table, self.spec.fingerprint
        index = table.header_row
        if index is None:
            index = header_matching(rows, fingerprint.headers)
        if index is None:
            index = fingerprint.header_row_hint
        if index is None:
            index = find_header(rows)
        if index >= len(rows):
            raise ParseFailedError("The header row was not found.")
        return index

    def _columns(self, header: list[Any]) -> dict[str, int | None]:
        names = self.spec.columns
        resolved: dict[str, int | None] = {}
        for key in ("date", "description", "amount", "debit", "credit", "balance", "ext_id"):
            name = getattr(names, key)
            if name is None:
                resolved[key] = None
                continue
            index = column_index(header, name)
            if index is None:
                raise ParseFailedError(f'The column "{name}" was not found.')
            resolved[key] = index
        return resolved

    def _date(self, raw: list[Any], columns: dict[str, int | None]) -> str | None:
        index = columns["date"]
        if index is None or index >= len(raw):
            return None
        return read_date(raw[index], self.spec.formats.date)

    def _amount(self, raw: list[Any], columns: dict[str, int | None]) -> Decimal | None:
        formats = self.spec.formats
        if columns["amount"] is not None:
            cell = raw[columns["amount"]] if columns["amount"] < len(raw) else None
            return read_number(cell, formats)
        debit = _cell(raw, columns["debit"])
        credit = _cell(raw, columns["credit"])
        debit_value = read_number(debit, formats)
        if debit_value is not None and debit_value != 0:
            return -abs(debit_value)
        credit_value = read_number(credit, formats)
        return abs(credit_value) if credit_value is not None else None

    def _row(self, raw: list[Any], columns: dict[str, int | None]) -> BankRow | None:
        date = self._date(raw, columns)
        amount = self._amount(raw, columns)
        description = re.sub(r"\s+", " ", str(_cell(raw, columns["description"]) or "")).strip()
        if date is None or amount is None or not description:
            return None
        balance = (
            read_number(_cell(raw, columns["balance"]), self.spec.formats)
            if columns["balance"] is not None
            else None
        )
        external = _cell(raw, columns["ext_id"]) if columns["ext_id"] is not None else None
        return BankRow(
            kind="bank",
            date=date,
            description=description[:500],
            amount=_plain(amount),
            balance=None if balance is None else _plain(balance),
            external_id=_external_id(external),
        )

    def _skipped(self, description: str) -> bool:
        return any(safe_search(pattern, description, self.settings) for pattern in self._filters)

    def _meta(self, rows: list[BankRow]) -> ParseMeta:
        opening, closing, reconciled = _balances(rows)
        return ParseMeta(
            parser_id=self.id,
            parser_version=self.version,
            row_count=len(rows),
            opening_balance=None if opening is None else _plain(opening),
            closing_balance=None if closing is None else _plain(closing),
            reconciled=reconciled,
        )


def _cell(raw: list[Any], index: int | None) -> Any:
    return raw[index] if index is not None and index < len(raw) else None


def _external_id(value: object) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()[:500] or None


def _balances(rows: list[BankRow]) -> tuple[Decimal | None, Decimal | None, bool | None]:
    """Opening/closing balance and whether the balances follow from the amounts. Statements are
    oldest-first or newest-first, so both directions are tried."""
    with_balance = [r for r in rows if r.balance is not None]
    if len(with_balance) != len(rows) or not rows:
        return None, None, None
    amounts = [Decimal(r.amount) for r in rows]
    balances = [Decimal(r.balance) for r in rows if r.balance is not None]
    oldest_first = all(
        abs(balances[i - 1] + amounts[i] - balances[i]) <= _TOLERANCE for i in range(1, len(rows))
    )
    newest_first = all(
        abs(balances[i] + amounts[i - 1] - balances[i - 1]) <= _TOLERANCE
        for i in range(1, len(rows))
    )
    if oldest_first:
        return balances[0] - amounts[0], balances[-1], True
    if newest_first:
        return balances[-1] - amounts[-1], balances[0], True
    return None, balances[-1], False
