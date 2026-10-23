import importlib.util
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from types import ModuleType

import pytest

from parser_service.config import Settings
from parser_service.errors import ParseFailedError
from parser_service.models import BrokerRow, ParseResponse
from parser_service.parsers.banco_invest import BancoInvestXlsx
from parser_service.registry import DETECT_THRESHOLD, default_registry
from parser_service.sniff import sniff

from .conftest import SECRET
from .support.banco_invest import (
    HOLDERS,
    INVESTED_TOTAL,
    MARKET,
    MARKET_TOTAL,
    QUOTE,
    banco_invest_xlsx,
    lots_for,
)
from .support.files import make_csv, make_pdf, make_xlsx

SETTINGS = Settings(secret=SECRET)
LEGACY = Path(__file__).resolve().parents[3] / "docs" / "tools" / "bancoinvest_para_csv.py"


def _parse(data: bytes) -> ParseResponse:
    return BancoInvestXlsx().parse(sniff(data, SETTINGS))


def _rows(result: ParseResponse) -> list[BrokerRow]:
    return [row for row in result.rows if isinstance(row, BrokerRow)]


def test_reference_values_per_holder() -> None:
    rows = _rows(_parse(banco_invest_xlsx()))
    units: dict[str, Decimal] = {}
    cost: dict[str, Decimal] = {}
    for row in rows:
        assert row.holder is not None
        assert row.quantity is not None
        units[row.holder] = units.get(row.holder, Decimal(0)) + Decimal(row.quantity)
        cost[row.holder] = cost.get(row.holder, Decimal(0)) - Decimal(row.amount)
    assert {k: str(v) for k, v in units.items()} == {
        "Simão": "504.8609",
        "Vicente": "309.5371",
        "Rui": "1234.9144",
        "Liliana": "596.7909",
    }
    assert {k: f"{v * QUOTE:.2f}" for k, v in units.items()} == MARKET
    assert abs(sum(cost.values()) - INVESTED_TOTAL) < Decimal("0.01")
    assert sum(units.values()) * QUOTE - MARKET_TOTAL < Decimal("0.01")


def test_every_lot_is_a_buy_on_the_first_name_sub_account() -> None:
    result = _parse(banco_invest_xlsx())
    rows = _rows(result)
    assert len(rows) == 12
    assert {r.holder for r in rows} == {"Simão", "Vicente", "Rui", "Liliana"}
    assert {r.type for r in rows} == {"buy"}
    assert {r.symbol for r in rows} == {"INVTG"}
    assert {r.currency for r in rows} == {"EUR"}
    assert all(Decimal(r.amount) < 0 for r in rows)  # money leaves the account
    assert "SILVA" not in result.model_dump_json().upper()  # only the first name is kept
    assert result.meta.reconciled is True
    assert result.warnings == []


def test_current_price_is_a_price_entry() -> None:
    prices = _parse(banco_invest_xlsx()).prices
    assert [(p.symbol, p.date, p.price, p.currency) for p in prices] == [
        ("INVTG", "2026-10-11", "8.017", "EUR")
    ]


def test_reimport_gives_the_same_external_ids() -> None:
    first = [r.external_id for r in _rows(_parse(banco_invest_xlsx()))]
    second = [r.external_id for r in _rows(_parse(banco_invest_xlsx()))]
    assert first == second
    assert len(set(first)) == len(first)


def test_two_identical_lots_in_one_file_keep_distinct_ids() -> None:
    twin = ("Subscrição", datetime(2024, 9, 4), Decimal("1.0000"), Decimal("7.0000"))
    data = banco_invest_xlsx(extra_lots={HOLDERS[0][0]: [twin, twin]})
    ids = [r.external_id for r in _rows(_parse(data))]
    assert len(ids) == 14
    assert len(set(ids)) == 14


def test_a_redemption_is_a_sell_with_positive_cash() -> None:
    sale = ("Resgate", datetime(2026, 1, 5), Decimal("1.0000"), Decimal("8.0000"))
    rows = _rows(_parse(banco_invest_xlsx(extra_lots={HOLDERS[0][0]: [sale]})))
    sells = [r for r in rows if r.type == "sell"]
    assert [(r.quantity, r.amount) for r in sells] == [("1", "8")]


def test_lots_that_do_not_match_the_summary_do_not_reconcile() -> None:
    rows = [list(r) for r in _workbook_rows()]
    for row in rows:
        if row and row[0] == "Subscrição" and isinstance(row[2], float):
            row[2] += 5  # first lot of the first holder
            break
    result = _parse(make_xlsx({"Folha 1": rows}))
    assert result.meta.reconciled is False
    assert any("do not add up" in w for w in result.warnings)


def _workbook_rows() -> list[list[object]]:
    from .support.banco_invest import workbook_rows

    return workbook_rows()


def test_an_unknown_fund_keeps_its_name_and_asks_for_confirmation() -> None:
    from .support.banco_invest import workbook_rows

    result = _parse(make_xlsx({"Folha 1": workbook_rows(title="Fundo Exemplo - Posição Actual")}))
    assert {r.symbol for r in _rows(result)} == {"Fundo Exemplo"}
    assert any("ticker" in w for w in result.warnings)


def test_a_workbook_without_lots_fails() -> None:
    rows: list[list[object]] = [[TITLE_ONLY], [datetime(2026, 1, 1)], ["CONTA"], ["1"]]
    with pytest.raises(ParseFailedError):
        _parse(make_xlsx({"Folha 1": rows}))


TITLE_ONLY = "Invest Tendências Globais - Posição Actual"


def test_matches_the_python_script_on_the_same_input(tmp_path: Path) -> None:
    if not LEGACY.exists():
        pytest.skip("docs/tools is not part of this checkout")
    spec = importlib.util.spec_from_file_location("bancoinvest_para_csv", LEGACY)
    assert spec is not None
    assert spec.loader is not None
    legacy: ModuleType = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    path = tmp_path / "posicao.xlsx"
    path.write_bytes(banco_invest_xlsx())
    old = legacy.ler(str(path))
    mine = sorted(
        (r.holder, r.date, Decimal(r.quantity or "0"), Decimal(r.price or "0"))
        for r in _rows(_parse(banco_invest_xlsx()))
    )
    theirs = sorted(
        (
            lot["titular"].split()[0].capitalize(),
            lot["data"].isoformat(),
            Decimal(repr(lot["qtd"])),
            Decimal(repr(lot["preco"])),
        )
        for lot in old["lotes"]
    )
    assert mine == theirs
    assert old["data"].isoformat() == _parse(banco_invest_xlsx()).prices[0].date


def test_detection_matrix_for_the_workbook() -> None:
    cases = {
        "position.xlsx": (banco_invest_xlsx(), {"banco-invest-xlsx"}),
        "other.xlsx": (make_xlsx({"Other": [["x"]]}), set()),
        "bank.xlsx": (
            make_xlsx(
                {"Movimentos": [["Data Mov.", "Descrição", "Valor"], ["01-01-2026", "x", 1]]}
            ),
            set(),
        ),
        "plain.csv": (make_csv("a;b;c", "1;2;3"), set()),
        "random.pdf": (make_pdf(["Posição Actual"]), set()),
    }
    for name, (data, expected) in cases.items():
        found = {r.parser_id for r in default_registry().detect(sniff(data, SETTINGS))}
        assert found == expected, name


def test_a_title_without_the_summary_table_scores_below_the_threshold_of_a_full_match() -> None:
    data = make_xlsx({"Folha 1": [["Fundo - Posição Actual"], ["x"]]})
    score = BancoInvestXlsx().detect(sniff(data, SETTINGS))
    assert DETECT_THRESHOLD <= score < 0.95


def test_lots_for_adds_up() -> None:
    lots = lots_for(Decimal("100.1234"), Decimal("700.00"))
    assert sum(lot[2] for lot in lots) == Decimal("100.1234")
