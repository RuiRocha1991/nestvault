from collections import defaultdict
from datetime import datetime
from decimal import Decimal

import pytest

from parser_service.config import Settings
from parser_service.errors import ParseFailedError
from parser_service.models import BrokerRow, ParseResponse
from parser_service.parsers.xtb import XtbXlsx
from parser_service.registry import default_registry
from parser_service.sniff import sniff

from .conftest import SECRET
from .support.files import make_csv, make_pdf, make_xlsx
from .support.xtb import (
    ACCOUNT,
    DEPOSITS,
    GROSS,
    REFUND,
    TOTAL,
    WITHHOLDING,
    cash_rows,
    workbook,
    xtb_xlsx,
)

SETTINGS = Settings(secret=SECRET)


def _parse(data: bytes) -> ParseResponse:
    return XtbXlsx().parse(sniff(data, SETTINGS))


def _rows(result: ParseResponse) -> list[BrokerRow]:
    return [row for row in result.rows if isinstance(row, BrokerRow)]


def _sum(rows: list[BrokerRow], kind: str, *, with_symbol: bool | None = None) -> Decimal:
    return sum(
        (
            Decimal(r.amount)
            for r in rows
            if r.type == kind and (with_symbol is None or (r.symbol is not None) == with_symbol)
        ),
        Decimal(0),
    )


def test_reference_values() -> None:
    result = _parse(xtb_xlsx())
    rows = _rows(result)
    assert _sum(rows, "dividend") == Decimal(GROSS)
    assert _sum(rows, "tax", with_symbol=True) == Decimal(WITHHOLDING)
    assert _sum(rows, "refund") == Decimal(REFUND)
    assert _sum(rows, "deposit") == Decimal(DEPOSITS)
    assert result.meta.closing_balance == TOTAL
    assert result.meta.reconciled is True
    assert result.meta.account_hint == ACCOUNT
    assert result.warnings == []


def test_tax_refund_is_not_netted_against_the_tax_withheld() -> None:
    rows = _rows(_parse(xtb_xlsx()))
    assert [r.type for r in rows].count("refund") == 1
    assert all(Decimal(r.amount) < 0 for r in rows if r.type == "tax")
    assert all(Decimal(r.amount) > 0 for r in rows if r.type == "refund")


def test_trades_take_quantity_and_price_from_the_comment() -> None:
    buys = [r for r in _rows(_parse(xtb_xlsx())) if r.type == "buy"]
    assert [(r.symbol, r.quantity, r.price, r.amount) for r in buys] == [
        ("AAA.US", "50", "10", "-500"),
        ("BBB.US", "20", "20", "-400"),
        ("CCC.US", "3", "145.82", "-437.46"),
    ]
    assert buys[0].name == "Alpha Exemplo"
    assert {r.currency for r in buys} == {"USD"}


def test_interest_and_its_tax_have_no_symbol() -> None:
    rows = _rows(_parse(xtb_xlsx()))
    assert [(r.type, r.symbol, r.amount) for r in rows if r.type == "interest"] == [
        ("interest", None, "0.09")
    ]
    assert [r.amount for r in rows if r.type == "tax" and r.symbol is None] == ["-0.07"]


def test_every_operation_keeps_its_xtb_id_so_a_reimport_adds_nothing() -> None:
    first = [r.external_id for r in _rows(_parse(xtb_xlsx()))]
    second = [r.external_id for r in _rows(_parse(xtb_xlsx()))]
    assert first == second
    assert len(set(first)) == len(first)
    assert all(i is not None and i.startswith("xtb:") for i in first)


def test_open_positions_become_price_entries() -> None:
    prices = {p.symbol: (p.price, p.date, p.currency) for p in _parse(xtb_xlsx()).prices}
    assert prices["AAA.US"] == ("11", "2026-10-10", "USD")
    assert set(prices) == {"AAA.US", "BBB.US", "CCC.US"}


def test_a_total_that_does_not_match_fails_reconciliation() -> None:
    result = _parse(xtb_xlsx(total=99.0))
    assert result.meta.reconciled is False
    assert any("do not add up" in w for w in result.warnings)


def test_unknown_operations_are_reported_and_break_reconciliation() -> None:
    odd = ["Mystery", "", "", "", datetime(2026, 9, 1), 1.0, "7777", "?", "My Trades", ""]
    result = _parse(xtb_xlsx(cash=[*cash_rows(), odd], total=12.25))
    assert any("1 operations of an unknown type" in w for w in result.warnings)
    assert result.meta.reconciled is False


def test_without_the_currency_the_user_is_asked_to_confirm() -> None:
    result = _parse(xtb_xlsx(currency=None))
    assert {r.currency for r in _rows(result)} == {"EUR"}
    assert any("currency" in w for w in result.warnings)


def test_a_report_without_operations_fails() -> None:
    with pytest.raises(ParseFailedError):
        _parse(xtb_xlsx(cash=[]))


def test_a_workbook_without_the_cash_sheet_fails() -> None:
    with pytest.raises(ParseFailedError):
        _parse(make_xlsx({"Other": [["x"]]}))


def test_detection_matrix_for_the_report() -> None:
    cases = {
        "report.xlsx": (xtb_xlsx(), {"xtb-xlsx"}),
        "other.xlsx": (make_xlsx({"Other": [["x"]]}), set()),
        "bank.xlsx": (
            make_xlsx(
                {"Movimentos": [["Data Mov.", "Descrição", "Valor"], ["01-01-2026", "x", 1]]}
            ),
            set(),
        ),
        "plain.csv": (make_csv("Type;Amount", "Dividend;1"), set()),
        "random.pdf": (make_pdf(["Cash Operations"]), set()),
    }
    for name, (data, expected) in cases.items():
        found = {r.parser_id for r in default_registry().detect(sniff(data, SETTINGS))}
        assert found == expected, name


def test_the_sheet_name_alone_is_not_enough_to_be_confident() -> None:
    sheets = workbook()
    sheets["Cash Operations"] = [["nothing"]]
    assert XtbXlsx().detect(sniff(make_xlsx(sheets), SETTINGS)) < 0.6


def test_dividends_of_one_symbol_and_day_share_symbol_and_date_with_their_tax() -> None:
    by_key: dict[tuple[str | None, str], set[str]] = defaultdict(set)
    for r in _rows(_parse(xtb_xlsx())):
        if r.type in ("dividend", "tax") and r.symbol:
            by_key[(r.symbol, r.date)].add(r.type)
    assert all(kinds == {"dividend", "tax"} for kinds in by_key.values())
