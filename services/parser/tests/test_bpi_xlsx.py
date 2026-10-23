import itertools
import json
from decimal import Decimal
from pathlib import Path

import pytest

from parser_service.config import Settings
from parser_service.errors import ParseFailedError
from parser_service.models import BankRow, ParseResponse
from parser_service.parsers.bpi_xlsx import BpiXlsx
from parser_service.registry import DETECT_THRESHOLD, default_registry
from parser_service.sniff import sniff

from .conftest import SECRET
from .support.bpi import (
    ACCOUNT,
    CLOSING,
    MOVEMENTS,
    TRAINER_IBAN,
    bpi_xlsx,
    opening_balance,
    table_rows,
    workbook,
)
from .support.files import make_csv, make_pdf, make_xlsx

SETTINGS = Settings(secret=SECRET)
FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "bpi"


def _parse(data: bytes) -> ParseResponse:
    return BpiXlsx().parse(sniff(data, SETTINGS))


def _rows(result: ParseResponse) -> list[BankRow]:
    return [row for row in result.rows if isinstance(row, BankRow)]


def test_reference_values() -> None:
    result = _parse(bpi_xlsx())
    rows = _rows(result)
    assert len(rows) == len(MOVEMENTS) == result.meta.row_count
    assert rows[-1].date == "2026-09-30"
    assert Decimal(rows[-1].balance or "0") == CLOSING == Decimal("3959.43")
    assert result.meta.closing_balance == "3959.43"
    assert Decimal(result.meta.opening_balance or "0") == opening_balance()
    assert result.meta.account_hint == ACCOUNT
    assert result.meta.reconciled is True
    assert result.warnings == []


def test_rows_come_out_oldest_first_with_the_sign_of_the_amount() -> None:
    rows = _rows(_parse(bpi_xlsx()))
    assert [r.date for r in rows] == sorted(r.date for r in rows)
    assert rows[0].amount == "-300"
    assert rows[3].amount == "1850"
    assert sum((Decimal(r.amount) for r in rows), opening_balance()) == CLOSING


def test_every_running_balance_follows_the_one_before() -> None:
    rows = _rows(_parse(bpi_xlsx()))
    for before, row in itertools.pairwise(rows):
        assert Decimal(before.balance or "0") + Decimal(row.amount) == Decimal(row.balance or "0")


def test_descriptions_are_trimmed_and_keep_the_iban() -> None:
    rows = _rows(_parse(bpi_xlsx()))
    assert all(r.description == r.description.strip() and "  " not in r.description for r in rows)
    assert any(TRAINER_IBAN in r.description for r in rows)


def test_the_statement_kind_is_tagged_when_the_description_says_it() -> None:
    by_description = {r.description: r.type for r in _rows(_parse(bpi_xlsx()))}
    assert by_description["03/09 COMPRA ELEC 1234567/02 REPSOL LISBOA"] == "card"
    assert by_description["TRF CR INTRAB 77 DE FAMILIAR EXEMPLO"] == "transfer"
    assert by_description["IMPOSTO DE SELO"] == "fee"
    assert by_description["JUROS DE EMPRESTIMO"] is None


def test_a_balance_that_does_not_follow_fails_reconciliation() -> None:
    rows = table_rows()
    rows[5][4] = float(rows[5][4]) + 1  # type: ignore[arg-type]
    result = _parse(bpi_xlsx(movements=rows))
    assert result.meta.reconciled is False
    assert "do not add up" in result.warnings[0]


def test_rows_without_an_amount_are_reported_and_break_reconciliation() -> None:
    rows = table_rows()
    rows[2][3] = None
    result = _parse(bpi_xlsx(movements=rows))
    assert len(result.rows) == len(MOVEMENTS) - 1
    assert result.meta.reconciled is False
    assert any("skipped" in w for w in result.warnings)


def test_a_statement_without_balances_is_not_reconciled() -> None:
    rows = [[*r[:4], None] for r in table_rows()]
    result = _parse(bpi_xlsx(movements=rows))
    assert result.meta.reconciled is None
    assert result.meta.closing_balance is None


def test_a_description_is_data_not_a_command() -> None:
    rows = table_rows()
    rows[0][2] = '\' OR 1=1 --; =HYPERLINK("x")'
    assert _rows(_parse(bpi_xlsx(movements=rows)))[-1].description == rows[0][2]


def test_a_statement_without_movements_fails() -> None:
    with pytest.raises(ParseFailedError):
        _parse(bpi_xlsx(movements=[]))


def test_a_workbook_without_the_sheet_fails() -> None:
    with pytest.raises(ParseFailedError):
        _parse(make_xlsx({"Other": [["x"]]}))


def test_a_sheet_without_the_table_fails() -> None:
    sheets = workbook()
    sheets["Movimentos"] = sheets["Movimentos"][:12]
    with pytest.raises(ParseFailedError):
        _parse(make_xlsx(sheets))


def test_the_fixture_file_matches_the_generator_and_the_expected_rows() -> None:
    assert (FIXTURES / "bpi-movimentos.anonymized.xlsx").exists()
    expected = json.loads((FIXTURES / "bpi-movimentos.expected.json").read_text())
    assert _parse(bpi_xlsx()).model_dump(mode="json") == expected
    committed = (FIXTURES / "bpi-movimentos.anonymized.xlsx").read_bytes()
    assert _parse(committed).model_dump(mode="json") == expected


def test_detection_matrix_for_the_statement() -> None:
    cases = {
        "statement.xlsx": (bpi_xlsx(), {"bpi-xlsx"}),
        "other.xlsx": (make_xlsx({"Other": [["x"]]}), set()),
        "same-sheet-other-bank.xlsx": (
            make_xlsx(
                {"Movimentos": [["Data Mov.", "Descrição", "Valor"], ["01-01-2026", "x", 1]]}
            ),
            set(),
        ),
        "plain.csv": (make_csv("Data Mov.;Valor em EUR", "01-01-2026;1"), set()),
        "random.pdf": (make_pdf(["BPI Net EXTRACTO MOVIMENTOS"]), set()),
    }
    for name, (data, expected) in cases.items():
        found = {r.parser_id for r in default_registry().detect(sniff(data, SETTINGS))}
        assert found == expected, name


def test_the_sheet_name_alone_is_not_enough_to_be_confident() -> None:
    data = make_xlsx({"Movimentos": [["nothing"]]})
    assert BpiXlsx().detect(sniff(data, SETTINGS)) < DETECT_THRESHOLD


def test_the_table_without_the_bank_marker_scores_lower_but_still_detects() -> None:
    sheets = workbook()
    sheets["Movimentos"][0] = ["Extracto"]
    score = BpiXlsx().detect(sniff(make_xlsx(sheets), SETTINGS))
    assert DETECT_THRESHOLD <= score < BpiXlsx().detect(sniff(bpi_xlsx(), SETTINGS))
