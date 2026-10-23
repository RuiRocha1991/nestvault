import csv
import io
from pathlib import Path

import pytest

from parser_service.config import Settings
from parser_service.errors import ParseFailedError, UnsupportedFileError
from parser_service.models import BrokerRow, ParseResponse
from parser_service.parsers.investment_csv import InvestmentCsv, export_csv, template_csv
from parser_service.registry import default_registry
from parser_service.sniff import sniff

from .conftest import SECRET
from .support.files import make_csv, make_pdf, make_xlsx
from .support.xtb import xtb_xlsx

SETTINGS = Settings(secret=SECRET)
TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "investment-transactions.csv"
HEADER = (
    "Data;Tipo;Ticker;Nome;Tipo de ativo;Moeda;Quantidade;Preço;Comissão;Subconta;Titular;"
    "Cotação atual;Data cotação"
)
SAMPLE = [
    HEADER,
    "05/01/2026;Compra;FUNDX;Fundo Exemplo;Fundo;EUR;10,5;1.234,56;1,50;Ana;Ana Exemplo;"
    "1300,00;01/02/2026",
    "2026-02-10;Venda;FUNDX;Fundo Exemplo;Fundo;EUR;2;1.300,00;;Ana;Ana Exemplo;;",
    "15/03/2026;Dividendo;FUNDX;;;EUR;;;;Ana;;;",
]


def _parse(data: bytes) -> ParseResponse:
    return InvestmentCsv().parse(sniff(data, SETTINGS))


def _rows(result: ParseResponse) -> list[BrokerRow]:
    return [row for row in result.rows if isinstance(row, BrokerRow)]


def test_parses_the_prototype_format() -> None:
    result = _parse(make_csv(*SAMPLE[:3]))
    buy, sell = _rows(result)
    assert (buy.type, buy.date, buy.symbol, buy.currency) == ("buy", "2026-01-05", "FUNDX", "EUR")
    assert (buy.quantity, buy.price, buy.fee) == ("10.5", "1234.56", "1.5")
    assert buy.amount == "-12964.38"  # 10.5 * 1234.56 + 1.50
    assert (buy.subaccount, buy.holder, buy.asset_type) == ("Ana", "Ana Exemplo", "Fundo")
    assert sell.type == "sell" and sell.amount == "2600"
    assert [(p.symbol, p.date, p.price) for p in result.prices] == [("FUNDX", "2026-02-01", "1300")]
    assert result.meta.subaccounts == ["Ana"]
    assert result.meta.row_count == 2 and result.warnings == []


def test_dividend_uses_value_and_tax() -> None:
    data = make_csv(
        "Data;Tipo;Ticker;Moeda;Quantidade;Preço;Valor;Imposto",
        "01/06/2026;Dividendo;ABC;USD;;;12,40;3,10",
    )
    (row,) = _rows(_parse(data))
    assert (row.type, row.amount, row.tax, row.quantity, row.price) == (
        "dividend", "12.4", "3.1", None, None,
    )  # fmt: skip


def test_english_headers_and_other_encodings() -> None:
    data = make_csv(
        "Date,Type,Symbol,Quantity,Price,Sub-account",
        "2026-01-05,Buy,abc,2,10.5,Rui",
        encoding="utf-8",
    )
    (row,) = _rows(_parse(data))
    assert (row.symbol, row.amount, row.subaccount) == ("ABC", "-21", "Rui")
    latin = make_csv(
        HEADER, "05/01/2026;Compra;ABC;Subscrição;;EUR;1;10;;Subscrição Rui;;;", encoding="cp1252"
    )
    assert _rows(_parse(latin))[0].subaccount == "Subscrição Rui"


def test_identical_lines_in_one_file_get_distinct_ids_and_reimport_is_stable() -> None:
    data = make_csv(HEADER, SAMPLE[1], SAMPLE[1])
    first = _rows(_parse(data))
    ids = [r.external_id for r in first]
    assert len(set(ids)) == 2 and str(ids[0]).split("#")[0] == str(ids[1]).split("#")[0]
    assert [r.external_id for r in _rows(_parse(data))] == ids


def test_unknown_sub_accounts_are_listed_for_the_preview() -> None:
    data = make_csv(
        HEADER, "05/01/2026;Compra;A;;;EUR;1;1;;Zeta;;;", "05/01/2026;Compra;A;;;EUR;1;1;;alfa;;;",
        "05/01/2026;Compra;A;;;EUR;1;1;;;Maria Exemplo;;",
    )  # fmt: skip
    assert _parse(data).meta.subaccounts == ["alfa", "Maria Exemplo", "Zeta"]


@pytest.mark.parametrize("payload", ['=HYPERLINK("http://x")', "+SUM(1)", "-2+3", "@cmd"])
def test_formula_cells_stay_text(payload: str) -> None:
    data = make_csv(
        HEADER, f"05/01/2026;Compra;ABC;{payload};{payload};EUR;1;10;;{payload};{payload};;"
    )
    result = _parse(data)
    (row,) = _rows(result)
    assert (row.name, row.asset_type, row.subaccount, row.holder) == (payload,) * 4
    assert row.amount == "-10" and "formula" in result.warnings[0]
    out = export_csv([row])
    cells = list(csv.reader(io.StringIO(out), delimiter=";"))[1]
    assert cells[3] == cells[4] == cells[11] == cells[12] == f"'{payload}"


def test_formula_in_numeric_cells_is_not_evaluated() -> None:
    data = make_csv(HEADER, "05/01/2026;Compra;ABC;;;EUR;=1+1;10;;;;;", SAMPLE[1])
    result = _parse(data)
    assert len(result.rows) == 1 and "ignored" in result.warnings[0]


def test_bad_rows_are_ignored_with_a_warning() -> None:
    data = make_csv(
        HEADER,
        SAMPLE[1],
        "not a date;Compra;ABC;;;EUR;1;10;;;;;",
        "05/01/2026;Juros;ABC;;;EUR;1;10;;;;;",
        "05/01/2026;Compra;ABC;;;EURO;1;10;;;;;",
        "05/01/2026;Compra;ABC;;;EUR;0;10;;;;;",
        ";;;;;;;;;;;;",
    )
    result = _parse(data)
    assert len(result.rows) == 1
    assert len(result.warnings) == 2


def test_template_round_trips() -> None:
    assert TEMPLATE.read_text(encoding="utf-8") == template_csv()
    first = _parse(template_csv().encode())
    again = _parse(export_csv(_rows(first), first.prices).encode())
    assert again.rows == first.rows and again.prices == first.prices
    assert [r.type for r in _rows(first)] == ["buy", "dividend"]
    assert first.warnings == []


@pytest.mark.parametrize(
    "lines",
    [
        ["Data;Descricao;Montante", "05/01/2026;x;1"],
        ["Data;Tipo;Quantidade;Preço", "05/01/2026;Compra;1;1"],
        [HEADER],
        [HEADER, "x;y"],
    ],
)
def test_files_that_do_not_fit_are_refused(lines: list[str]) -> None:
    with pytest.raises(ParseFailedError):
        _parse(make_csv(*lines))


def test_non_csv_input_is_refused() -> None:
    with pytest.raises(UnsupportedFileError):
        InvestmentCsv().parse(sniff(make_xlsx({"S": [["a"]]}), SETTINGS))


def test_only_this_parser_detects_it() -> None:
    registry = default_registry()
    for name, data in {
        "template": template_csv().encode(),
        "sample": make_csv(*SAMPLE),
    }.items():
        assert [r.parser_id for r in registry.detect(sniff(data, SETTINGS))] == [
            "investment-csv"
        ], name
    for data in (
        make_csv("a;b;c", "1;2;3"),
        make_csv("Data;Descrição;Montante;Saldo", "05/01/2026;Café;-1,20;100"),
        make_pdf(["nothing"]),
        make_xlsx({"Other": [["x"]]}),
        xtb_xlsx(),
    ):
        assert "investment-csv" not in [r.parser_id for r in registry.detect(sniff(data, SETTINGS))]
