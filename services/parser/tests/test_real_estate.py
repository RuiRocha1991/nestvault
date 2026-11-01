from collections.abc import Callable
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from parser_service.app import create_app
from parser_service.config import Settings
from parser_service.errors import ParseFailedError
from parser_service.real_estate.csv_templates import (
    LoanInstallmentsCsv,
    WorksPaymentsCsv,
    installments_template,
    payments_template,
)
from parser_service.real_estate.models import (
    InflationRow,
    InstallmentRow,
    PrepaymentRow,
    RealEstateParseResponse,
    WorkPaymentRow,
    WorkRow,
)
from parser_service.real_estate.registry import default_real_estate_registry
from parser_service.real_estate.workbook import MortgageWorkbookXlsx
from parser_service.registry import DETECT_THRESHOLD, default_registry
from parser_service.sniff import SniffedFile, sniff

from .conftest import AUTH, SECRET
from .support.bpi import bpi_xlsx
from .support.files import make_csv, make_pdf, make_xlsx
from .support.mortgage import (
    COSTS_TOTAL,
    CREDIT_INSURANCE_TOTAL,
    EXPECTED,
    FIXTURE,
    ROWS,
    TOTAL_ROWS,
    WORKS_TOTAL,
    mortgage_workbook,
)

SETTINGS = Settings(secret=SECRET)
SCHEMA = Path(__file__).resolve().parent.parent / "schemas" / "real-estate.schema.json"


def _parse(data: bytes) -> RealEstateParseResponse:
    return MortgageWorkbookXlsx().parse(sniff(data, SETTINGS))


def _sum(values: list[str]) -> Decimal:
    return sum((Decimal(v) for v in values), Decimal(0))


@pytest.fixture(scope="module")
def workbook() -> RealEstateParseResponse:
    return _parse(mortgage_workbook())


def test_the_fixture_is_what_the_generator_writes() -> None:
    assert FIXTURE.read_bytes() != b""
    assert _parse(FIXTURE.read_bytes()).model_dump() == _parse(mortgage_workbook()).model_dump()


def test_the_expected_output_is_what_the_parser_makes() -> None:
    """`mortgage-workbook.expected.json` is what the Node tests use as the parser's answer."""
    import json

    assert json.loads(EXPECTED.read_text("utf-8")) == _parse(FIXTURE.read_bytes()).model_dump(
        mode="json"
    )


def test_reference_totals(workbook: RealEstateParseResponse) -> None:
    installments = [r for r in workbook.rows if isinstance(r, InstallmentRow)]
    prepayments = [r for r in workbook.rows if isinstance(r, PrepaymentRow)]
    works = [r for r in workbook.rows if isinstance(r, WorkRow)]
    payments = [r for r in workbook.rows if isinstance(r, WorkPaymentRow)]
    inflation = [r for r in workbook.rows if isinstance(r, InflationRow)]
    assert [len(x) for x in (installments, prepayments, works, payments, inflation)] == list(
        ROWS.values()
    )
    capital = _sum([r.capital for r in installments]) + _sum([r.amount for r in prepayments])
    assert capital == Decimal("25511.72")
    assert _sum([r.interest for r in installments]) == Decimal("14058.99")
    assert _sum([r.budget for r in works]) == WORKS_TOTAL == Decimal("22071.46")
    assert _sum([r.amount for r in payments]) == WORKS_TOTAL
    assert _sum([r.credit_insurance for r in installments]) == CREDIT_INSURANCE_TOTAL
    assert workbook.meta.acquisition_costs is not None
    costs = workbook.meta.acquisition_costs
    assert (
        _sum([costs.deed, costs.imt, costs.stamp_duty, costs.registration, costs.bank_fees])
        == COSTS_TOTAL
        == Decimal("2559.71")
    )
    assert workbook.warnings == [
        "prepayment_removed_from_capital:1",
        "deposit_read_as_fraction:4",
    ]


def test_row_counts_match_the_import_dialog(workbook: RealEstateParseResponse) -> None:
    assert len(workbook.rows) == workbook.meta.row_count == TOTAL_ROWS == 92
    by_sheet = {s.sheet: s.rows for s in workbook.meta.sheets if s.action != "recalculated"}
    assert by_sheet == {
        "Sumário": 73,
        "Amortização": 1,
        "Remodelações": 4,
        "Pagamentos": 8,
        "Inflação": 6,
    }
    actions = {s.sheet: s.action for s in workbook.meta.sheets}
    assert actions["Inflação"] == "shown"  # read, but the app has no store for it
    assert actions["Sumário"] == "import"
    derived = [s for s in workbook.meta.sheets if s.action == "recalculated"]
    assert len(derived) == 1
    assert derived[0].rows == 0
    assert "Resumo" in derived[0].sheet


def test_installments_are_numbered_dated_and_in_order(workbook: RealEstateParseResponse) -> None:
    installments = [r for r in workbook.rows if isinstance(r, InstallmentRow)]
    assert [r.number for r in installments] == list(range(1, 74))
    assert installments[0].due_date == "2020-09-05"
    assert installments[-1].due_date == "2026-09-05"
    assert installments[67].credit_insurance == "37.56"  # 04/2026
    assert installments[66].credit_insurance == "0"
    assert installments[0].fees == "3.8"


def test_prepayment_and_works_details(workbook: RealEstateParseResponse) -> None:
    prepayment = next(r for r in workbook.rows if isinstance(r, PrepaymentRow))
    assert (prepayment.date, prepayment.amount, prepayment.fee) == ("2023-02-01", "15000", None)
    kitchen = next(r for r in workbook.rows if isinstance(r, WorkRow))
    assert kitchen.name == "Kitchen refit"
    assert kitchen.deposit_pct == "30"  # the sheet stores 0.3
    assert kitchen.status == "done"
    assert kitchen.start_date == "2023-03-01"
    phase = next(r for r in workbook.rows if isinstance(r, WorkPaymentRow))
    assert (phase.planned_date, phase.paid_date, phase.status) == (
        "2023-03-01",
        "2023-03-03",
        "paid",
    )


def test_output_validates_against_the_schema(workbook: RealEstateParseResponse) -> None:
    import json

    validator = Draft202012Validator(json.loads(SCHEMA.read_text("utf-8")))
    assert list(validator.iter_errors(workbook.model_dump(mode="json"))) == []


def test_formulas_are_not_evaluated() -> None:
    """A formula has no cached value when the file was not saved by a spreadsheet program."""
    head: list[object] = ["Nº", "Data", "Amortização", "Juros"]
    data = make_xlsx(
        {
            "Sumário": [
                head,
                [1, "2026-01-05", 100, 20],
                [2, "2026-02-05", "=C2+1", 20],
                [None, None, "=SUM(C2:C3)", "=SUM(D2:D3)"],
            ]
        }
    )
    result = _parse(data)
    assert [r.number for r in result.rows if isinstance(r, InstallmentRow)] == [1]
    assert "installments_without_values:1" in result.warnings


def test_a_workbook_without_installments_fails() -> None:
    data = make_xlsx({"Sumário": [["Nº", "Data", "Amortização", "Juros"]]})
    with pytest.raises(ParseFailedError):
        _parse(data)


def test_repeated_installment_numbers_keep_the_first() -> None:
    head: list[object] = ["Nº", "Data", "Amortização", "Juros"]
    data = make_xlsx({"Sumário": [head, [1, "2026-01-05", 100, 20], [1, "2026-02-05", 999, 20]]})
    result = _parse(data)
    assert [r.capital for r in result.rows if isinstance(r, InstallmentRow)] == ["100"]
    assert "installments_repeated:1" in result.warnings


def test_payment_marked_paid_without_a_date_stays_planned() -> None:
    data = make_xlsx(
        {
            "Sumário": [["Nº", "Data", "Amortização", "Juros"], [1, "2026-01-05", 1, 1]],
            "Pagamentos": [
                ["Obra", "Descrição", "Valor", "Data prevista", "Data de pagamento", "Estado"],
                ["Kitchen", "Deposit", 100, "2026-02-01", None, "Pago"],
            ],
        }
    )
    result = _parse(data)
    phase = next(r for r in result.rows if isinstance(r, WorkPaymentRow))
    assert phase.status == "planned"
    assert phase.paid_date is None
    assert "payments_paid_without_date:1" in result.warnings


def _with_summary(rows: list[list[object]]) -> RealEstateParseResponse:
    return _parse(
        make_xlsx(
            {
                "Sumário": [["Nº", "Data", "Amortização", "Juros"], [1, "2026-01-05", 1, 1]],
                "Resumo": rows,
            }
        )
    )


def test_the_loan_stamp_tax_line_is_not_the_purchase_stamp_duty() -> None:
    result = _with_summary(
        [
            ["Empréstimo"],
            ["Imposto de selo", 400],
            ["Custos de aquisição"],
            ["Escritura", 100],
            ["Imposto de selo", 992],
        ]
    )
    assert result.meta.acquisition_costs is not None
    assert result.meta.acquisition_costs.stamp_duty == "992"


def test_a_stamp_line_outside_the_acquisition_section_is_ignored_with_a_warning() -> None:
    result = _with_summary([["Empréstimo"], ["Imposto de selo", 400], ["IMT", 5]])
    assert result.meta.acquisition_costs is not None
    assert result.meta.acquisition_costs.stamp_duty == "0"
    assert "stamp_duty_not_found" in result.warnings


def test_the_explicit_purchase_stamp_label_is_read_anywhere() -> None:
    result = _with_summary(
        [["Imposto de selo compra", 700], ["Empréstimo"], ["Imposto de selo", 9]]
    )
    assert result.meta.acquisition_costs is not None
    assert result.meta.acquisition_costs.stamp_duty == "700"


@pytest.mark.parametrize(
    ("cell", "expected", "warning"),
    [
        (0.25, "25", "deposit_read_as_fraction:1"),
        (0.5, "50", "deposit_read_as_fraction:1"),
        (1, "1", "deposit_one_read_as_percent:1"),
        (25, "25", None),
        (100, "100", None),
    ],
)
def test_the_deposit_rule(cell: float, expected: str, warning: str | None) -> None:
    result = _parse(
        make_xlsx(
            {
                "Sumário": [["Nº", "Data", "Amortização", "Juros"], [1, "2026-01-05", 1, 1]],
                "Remodelações": [["Obra", "Orçamento", "Entrada"], ["Kitchen", 1000, cell]],
            }
        )
    )
    work = next(r for r in result.rows if isinstance(r, WorkRow))
    assert work.deposit_pct == expected
    assert [w for w in result.warnings if w.startswith("deposit")] == ([warning] if warning else [])


def test_sheets_and_columns_are_capped_like_the_sniffer() -> None:
    wide: list[list[object]] = [["Nº", "Data", "Amortização", "Juros"] + [None] * 100]
    wide[0][90] = "Seguro vida"
    wide.append([1, "2026-01-05", 1, 1] + [None] * 86 + [55] + [None] * 9)
    sheets: dict[str, list[list[object]]] = {"Sumário": wide}
    for index in range(30):
        sheets[f"Extra {index}"] = [["x"]]
    result = _parse(make_xlsx(sheets))
    row = next(r for r in result.rows if isinstance(r, InstallmentRow))
    assert row.life_insurance == "0"  # the column past MAX_COLUMNS is not read


def test_a_csv_the_reader_rejects_is_a_clean_422() -> None:
    huge = "x" * 200_000  # over the csv module field limit
    data = f"Nº;Data;Amortização;Juros\n1;2026-01-05;100;20\n2;2026-02-05;{huge};20\n".encode()
    with pytest.raises(ParseFailedError):
        LoanInstallmentsCsv().parse(sniff(data, SETTINGS))


def _prepayment_book(capital: int) -> RealEstateParseResponse:
    head: list[object] = ["Nº", "Data", "Amortização", "Juros"]
    return _parse(
        make_xlsx(
            {
                "Sumário": [
                    head,
                    [1, "2026-01-05", 100, 20],
                    [2, "2026-02-05", capital, 20],
                    [3, "2026-03-05", 101, 20],
                ],
                "Amortização": [["Data", "Valor"], ["2026-02-01", 500]],
            }
        )
    )


def test_the_capital_of_the_prepayment_month_is_stored_without_the_extra() -> None:
    result = _prepayment_book(600)  # 100 regular + 500 amortised early, as in the real workbook
    capital = {r.number: r.capital for r in result.rows if isinstance(r, InstallmentRow)}
    assert capital == {1: "100", 2: "100", 3: "101"}
    assert "prepayment_removed_from_capital:1" in result.warnings
    prepayment = next(r for r in result.rows if isinstance(r, PrepaymentRow))
    assert prepayment.amount == "500"  # the event keeps the whole amount


def test_a_capital_smaller_than_the_prepayment_is_left_alone_with_a_warning() -> None:
    result = _prepayment_book(100)
    capital = {r.number: r.capital for r in result.rows if isinstance(r, InstallmentRow)}
    assert capital == {1: "100", 2: "100", 3: "101"}
    assert "prepayment_not_in_capital:1" in result.warnings


# --- CSV templates -----------------------------------------------------------------------------


def test_the_installments_template_parses() -> None:
    result = LoanInstallmentsCsv().parse(sniff(installments_template().encode(), SETTINGS))
    rows = [r for r in result.rows if isinstance(r, InstallmentRow)]
    assert [r.number for r in rows] == [1, 2]
    assert rows[0].capital == "120.5"
    assert rows[0].life_insurance == "12.4"


def test_the_payments_template_parses() -> None:
    result = WorksPaymentsCsv().parse(sniff(payments_template().encode(), SETTINGS))
    rows = [r for r in result.rows if isinstance(r, WorkPaymentRow)]
    assert [(r.work, r.status) for r in rows] == [("Kitchen", "paid"), ("Kitchen", "planned")]
    assert rows[0].paid_date == "2026-01-12"


def test_the_templates_in_the_repository_are_the_code_templates() -> None:
    templates = Path(__file__).resolve().parents[1] / "templates"
    assert (templates / "loan-installments.csv").read_text("utf-8") == installments_template()
    assert (templates / "works-payments.csv").read_text("utf-8") == payments_template()


def test_csv_accepts_windows_1252_and_other_delimiters() -> None:
    data = make_csv(
        "Número,Data,Capital,Juros",
        '1,05/01/2026,"1.200,50",300',
        encoding="cp1252",
    )
    result = LoanInstallmentsCsv().parse(sniff(data, SETTINGS))
    row = result.rows[0]
    assert isinstance(row, InstallmentRow)
    assert (row.capital, row.due_date) == ("1200.5", "2026-01-05")


def test_csv_formula_looking_text_stays_text() -> None:
    data = make_csv(
        "Obra;Descrição;Valor;Data prevista;Data de pagamento",
        "=HYPERLINK(1);+cmd;100;2026-01-01;",
    )
    row = WorksPaymentsCsv().parse(sniff(data, SETTINGS)).rows[0]
    assert isinstance(row, WorkPaymentRow)
    assert (row.work, row.description) == ("=HYPERLINK(1)", "+cmd")


def test_csv_without_usable_rows_fails() -> None:
    with pytest.raises(ParseFailedError):
        LoanInstallmentsCsv().parse(sniff(make_csv("Número;Data;Capital;Juros"), SETTINGS))


# --- Detection ---------------------------------------------------------------------------------

REAL_ESTATE_FIXTURES: dict[str, tuple[Callable[[], bytes], set[str]]] = {
    "workbook": (mortgage_workbook, {"mortgage-workbook-xlsx"}),
    "installments.csv": (lambda: installments_template().encode(), {"loan-installments-csv"}),
    "payments.csv": (lambda: payments_template().encode(), {"works-payments-csv"}),
}
STATEMENT_FIXTURES: dict[str, Callable[[], bytes]] = {
    "bpi.xlsx": bpi_xlsx,
    "unknown.xlsx": lambda: make_xlsx({"Other": [["x"]]}),
    "unknown.pdf": lambda: make_pdf(["nothing to see"]),
    "plain.csv": lambda: make_csv("a;b;c", "1;2;3"),
    "bank.csv": lambda: make_csv("Data;Descrição;Valor", "2026-01-05;Coffee;-1,20"),
    "investments.csv": lambda: (
        Path(__file__).resolve().parents[1] / "templates" / "investment-transactions.csv"
    ).read_bytes(),
    "similar-sheets.xlsx": lambda: make_xlsx(
        {
            "Sumário": [["Resumo"], ["Total", 1]],
            "Pagamentos": [["Data", "Valor"], ["2026-01-01", 1]],
        }
    ),
}


@pytest.mark.parametrize("name", sorted(REAL_ESTATE_FIXTURES))
def test_detection_matrix_real_estate_files(name: str) -> None:
    build, expected = REAL_ESTATE_FIXTURES[name]
    file = sniff(build(), SETTINGS)
    real_estate = {r.parser_id for r in default_real_estate_registry().detect(file)}
    statements = {r.parser_id for r in default_registry().detect(file)}
    assert real_estate == expected
    assert statements == set(), "a statement parser claims a real estate file"


@pytest.mark.parametrize("name", sorted(STATEMENT_FIXTURES))
def test_detection_matrix_statements_are_not_real_estate(name: str) -> None:
    file = sniff(STATEMENT_FIXTURES[name](), SETTINGS)
    assert default_real_estate_registry().detect(file) == []


def test_the_workbook_scores_by_how_many_sheets_it_has(workbook: RealEstateParseResponse) -> None:
    del workbook
    registry = default_real_estate_registry()
    full = registry.detect(sniff(mortgage_workbook(), SETTINGS))[0]
    assert full.confidence == 1.0
    only = make_xlsx({"Sumário": [["Nº", "Data", "Amortização", "Juros"]]})
    low = registry.detect(sniff(only, SETTINGS))
    assert [r.confidence for r in low] == [0.5]
    assert DETECT_THRESHOLD <= 0.5


# --- HTTP --------------------------------------------------------------------------------------


@pytest.fixture
def api() -> TestClient:
    return TestClient(create_app(Settings(secret=SECRET, job_timeout_seconds=20.0)))


def test_http_detect_and_parse_the_workbook(api: TestClient) -> None:
    data = mortgage_workbook()
    detected = api.post("/real-estate/detect", content=data, headers=AUTH).json()
    assert detected["results"][0]["parser_id"] == "mortgage-workbook-xlsx"
    body: dict[str, Any] = api.post(
        "/real-estate/parse?parser_id=mortgage-workbook-xlsx", content=data, headers=AUTH
    ).json()
    assert body["meta"]["row_count"] == 92
    assert len(body["rows"]) == 92


def test_http_requires_the_secret_and_a_known_parser(api: TestClient) -> None:
    data = installments_template().encode()
    assert api.post("/real-estate/detect", content=data).status_code == 401
    unknown = api.post("/real-estate/parse?parser_id=nope", content=data, headers=AUTH)
    assert unknown.status_code == 404
    wrong = api.post("/real-estate/parse?parser_id=works-payments-csv", content=data, headers=AUTH)
    assert wrong.status_code == 422


def test_http_rejects_a_renamed_binary(api: TestClient) -> None:
    response = api.post("/real-estate/detect", content=b"\x00\x01\x02binary", headers=AUTH)
    assert response.status_code == 415


def test_sniffed_csv_is_text() -> None:
    file: SniffedFile = sniff(installments_template().encode(), SETTINGS)
    assert file.magic == "csv"
