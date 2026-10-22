import importlib.util
import shutil
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import ModuleType

import pytest

from parser_service.config import Settings
from parser_service.errors import ParseFailedError
from parser_service.models import BankRow, ParseResponse
from parser_service.parsers.generic_pdf_lines import GenericPdfLines
from parser_service.parsers.trade_republic import TradeRepublicPdf, classify
from parser_service.registry import DETECT_THRESHOLD, default_registry
from parser_service.sniff import sniff

from .conftest import SECRET
from .support.files import make_csv, make_layout_pdf, make_pdf, make_xlsx
from .support.trade_republic import (
    CLOSING,
    INTEREST_LAST_12_MONTHS,
    INTEREST_TOTAL,
    MOVES,
    statement_lines,
    statement_pdf,
)

SETTINGS = Settings(secret=SECRET)
LEGACY = Path(__file__).resolve().parents[3] / "docs" / "tools" / "extrato_para_csv.py"


def _parse(data: bytes) -> ParseResponse:
    return TradeRepublicPdf().parse(sniff(data, SETTINGS))


def _bank_rows(data: bytes) -> list[BankRow]:
    return [row for row in _parse(data).rows if isinstance(row, BankRow)]


def test_statement_reconciles_to_the_closing_balance() -> None:
    result = _parse(statement_pdf())
    assert result.meta.opening_balance == "1000.00"
    assert result.meta.closing_balance == CLOSING
    assert result.meta.reconciled is True
    assert result.meta.row_count == len(MOVES)
    assert result.warnings == []


def test_interest_lines_are_tagged_and_add_up() -> None:
    rows = _bank_rows(statement_pdf())
    interest = [r for r in rows if r.type == "interest"]
    last_date = date.fromisoformat(rows[-1].date)
    since = last_date.replace(year=last_date.year - 1)
    recent = [r for r in interest if date.fromisoformat(r.date) > since]
    assert sum(Decimal(r.amount) for r in interest) == Decimal(INTEREST_TOTAL)
    assert sum(Decimal(r.amount) for r in recent) == Decimal(INTEREST_LAST_12_MONTHS)


def test_rows_have_signed_amounts_dates_and_types_across_both_page_layouts() -> None:
    rows = _bank_rows(statement_pdf())
    assert [(r.date, r.amount, r.type) for r in rows[2:6]] == [
        ("2024-11-19", "5000.00", "transfer"),
        ("2024-11-25", "-37.50", "card"),
        ("2024-12-02", "-500.00", "trade"),
        ("2024-12-31", "20.10", "interest"),
    ]
    assert rows[7].type == "dividend"
    assert rows[8].amount == "27.12"  # on page 2, columns moved
    assert rows[9].amount == "-386.24"
    assert rows[2].description.startswith("Transferência \u2013 Depósito aceite")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Transferência", "transfer"),
        ("Pagamento com cartão", "card"),
        ("JUROS", "interest"),
        ("Negociação", "trade"),
        ("Rendimento", "dividend"),
        ("Qualquer coisa", "other"),
        ("", "other"),
    ],
)
def test_classify(text: str, expected: str) -> None:
    assert classify(text) == expected


def test_blank_lines_inside_a_movement_do_not_lose_it() -> None:
    # 14 pt leading makes pdfplumber insert blank lines between the lines of a movement.
    spaced = make_layout_pdf(statement_lines(), leading=14)
    assert _bank_rows(spaced) == _bank_rows(statement_pdf())
    assert _parse(spaced).meta.reconciled is True


def test_an_unreadable_block_is_a_warning_and_breaks_reconciliation() -> None:
    pages = statement_lines()
    # Drop the year line of the first movement: the block can no longer be dated.
    pages[0] = [line for line in pages[0] if not line.startswith("2024  ")]
    result = _parse(make_layout_pdf(pages))
    assert any("could not be read" in w for w in result.warnings)
    assert result.meta.reconciled is False


def test_a_pdf_without_movements_fails() -> None:
    data = make_layout_pdf([["TRADE REPUBLIC BANK GMBH", "TRANSAÇÕES"]])
    with pytest.raises(ParseFailedError):
        _parse(data)


def test_another_bank_is_refused() -> None:
    with pytest.raises(ParseFailedError):
        _parse(make_pdf(["Some other bank", "01-01-2025 Coffee 2,00 100,00"]))


def test_matches_the_python_script_on_the_same_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not LEGACY.exists():
        pytest.skip("docs/tools is not part of this checkout")
    spec = importlib.util.spec_from_file_location("extrato_para_csv", LEGACY)
    assert spec is not None
    assert spec.loader is not None
    legacy: ModuleType = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy)
    monkeypatch.setattr(shutil, "which", lambda _name: None)  # same extractor: pdfplumber
    pdf = tmp_path / "statement.pdf"
    pdf.write_bytes(statement_pdf())
    expected = legacy.parse_trade_republic(legacy.pdf_para_texto(pdf))
    rows = _bank_rows(statement_pdf())
    assert len(rows) == len(expected) > 0
    for row, old in zip(rows, expected, strict=True):
        day, month, year = old["data"].split("-")
        assert row.date == f"{year}-{month}-{day}"
        assert row.description == old["descricao"]
        assert Decimal(row.amount) == Decimal(f"{old['valor']:.2f}")
        assert row.balance is not None
        assert Decimal(row.balance) == Decimal(f"{old['saldo']:.2f}")


def test_detection_matrix_for_pdf_parsers() -> None:
    cases = {
        "trade-republic.pdf": (statement_pdf(), {"trade-republic-pdf"}),
        "generic-lines.pdf": (
            make_pdf(
                [
                    "01-02-2025 Coffee 2,00 100,00",
                    "02-02-2025 Salary 1 000,00 1 100,00",
                    "03-02-2025 Rent 500,00 600,00",
                ]
            ),
            {"generic-pdf-lines"},
        ),
        "random.pdf": (make_pdf(["Lorem ipsum dolor sit amet"]), set()),
        "plain.csv": (make_csv("a;b;c", "1;2;3"), set()),
        "other.xlsx": (make_xlsx({"Other": [["x"]]}), set()),
    }
    for name, (data, expected) in cases.items():
        found = {r.parser_id for r in default_registry().detect(sniff(data, SETTINGS))}
        assert found == expected, name


def test_a_random_pdf_scores_below_the_threshold() -> None:
    file = sniff(make_pdf(["Invoice 2025", "Total 12,00"]), SETTINGS)
    assert TradeRepublicPdf().detect(file) < DETECT_THRESHOLD
    assert GenericPdfLines().detect(file) < DETECT_THRESHOLD


def test_generic_pdf_lines_parses_one_movement_per_line() -> None:
    data = make_pdf(
        [
            "Extrato",
            "01-02-2025 Coffee 2,00 98,00",
            "02-02-2025 02-02-2025 Salary 1 000,00 1 098,00",
            "03-02-25 Rent 500,00 598,00",
        ]
    )
    result = GenericPdfLines().parse(sniff(data, SETTINGS))
    assert [(r.date, r.description, r.amount, r.balance) for r in result.rows] == [  # type: ignore[union-attr]
        ("2025-02-01", "Coffee", "2.00", "98.00"),
        ("2025-02-02", "Salary", "1000.00", "1098.00"),
        ("2025-02-03", "Rent", "-500.00", "598.00"),
    ]
    assert result.meta.closing_balance == "598.00"


def test_generic_pdf_lines_without_movements_fails() -> None:
    with pytest.raises(ParseFailedError):
        GenericPdfLines().parse(sniff(make_pdf(["nothing here"]), SETTINGS))
