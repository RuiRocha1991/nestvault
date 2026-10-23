import base64
import json
from datetime import datetime
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from parser_service.config import Settings
from parser_service.engine.formats import read_date, read_number
from parser_service.engine.parser import SpecParser
from parser_service.engine.spec import Formats, ImportSpec
from parser_service.errors import ParseFailedError, ParserError
from parser_service.models import BankRow, ParseResponse
from parser_service.sniff import sniff

from .conftest import AUTH, SECRET
from .support.files import make_csv, make_xlsx

SETTINGS = Settings(secret=SECRET)

GENERIC_CSV = make_csv(
    "Data;Descrição;Montante;Saldo",
    "03-01-2026;Café Central;-1,20;998,80",
    "02-01-2026;Salário;1.500,00;1.000,00",
    "01-01-2026;Saldo inicial;0,00;-500,00",
    encoding="cp1252",
)
DEBIT_CREDIT_CSV = make_csv(
    "Data Mov.;Descritivo;Débito;Crédito;Saldo",
    "01/02/2026;Renda;500,00;;1.500,00",
    "02/02/2026;Salário;;2.000,00;3.500,00",
    "03/02/2026;Supermercado;80,50;;3.419,50",
)


def make_spec(**overrides: Any) -> ImportSpec:
    document: dict[str, Any] = {
        "id": "test-csv",
        "version": 1,
        "kind": "bank",
        "fingerprint": {"type": "csv", "headers": ["Data", "Descrição", "Montante", "Saldo"]},
        "table": {"findHeader": True},
        "columns": {
            "date": "Data",
            "description": "Descrição",
            "amount": "Montante",
            "balance": "Saldo",
        },
        "formats": {"date": "dd-mm-yyyy"},
    }
    document.update(overrides)
    return ImportSpec.model_validate(document)


def bank_rows(result: ParseResponse) -> list[BankRow]:
    return [row for row in result.rows if isinstance(row, BankRow)]


def parse(spec: ImportSpec, data: bytes) -> ParseResponse:
    return SpecParser(spec).parse(sniff(data, SETTINGS))


def test_generic_pt_pt_csv_parses_and_reconciles() -> None:
    result = parse(make_spec(), GENERIC_CSV)
    assert [(r.date, r.description, r.amount, r.balance) for r in bank_rows(result)] == [
        ("2026-01-03", "Café Central", "-1.2", "998.8"),
        ("2026-01-02", "Salário", "1500", "1000"),
        ("2026-01-01", "Saldo inicial", "0", "-500"),
    ]
    assert result.meta.reconciled is True
    assert result.meta.opening_balance == "-500"
    assert result.meta.closing_balance == "998.8"  # the file is newest first
    assert result.warnings == []


def test_debit_and_credit_columns() -> None:
    spec = make_spec(
        fingerprint={"type": "csv", "headers": ["Data Mov.", "Descritivo", "Débito", "Crédito"]},
        columns={
            "date": "Data Mov.",
            "description": "Descritivo",
            "debit": "Débito",
            "credit": "Crédito",
            "balance": "Saldo",
        },
        formats={"date": "dd/mm/yyyy", "negative": "debitColumn"},
    )
    result = parse(spec, DEBIT_CREDIT_CSV)
    assert [r.amount for r in bank_rows(result)] == ["-500", "2000", "-80.5"]
    assert result.meta.reconciled is True
    assert result.meta.opening_balance == "2000"
    assert result.meta.closing_balance == "3419.5"


def test_a_balance_that_does_not_follow_is_reported() -> None:
    data = make_csv(
        "Data;Descrição;Montante;Saldo", "01-01-2026;A;10,00;10,00", "02-01-2026;B;5,00;99,00"
    )
    result = parse(make_spec(), data)
    assert result.meta.reconciled is False
    assert any("balances" in w for w in result.warnings)


def test_without_a_balance_column_nothing_is_claimed() -> None:
    spec = make_spec(columns={"date": "Data", "description": "Descrição", "amount": "Montante"})
    assert parse(spec, GENERIC_CSV).meta.reconciled is None


def test_the_header_is_found_below_a_preamble_and_data_stops_at_the_empty_row() -> None:
    data = make_csv(
        "Extracto da conta",
        "Titular;Fulano",
        "",
        "Data;Descrição;Montante;Saldo",
        "01-01-2026;A;10,00;10,00",
        "",
        "Nota: movimentos apresentados na página",
    )
    result = parse(make_spec(), data)
    assert [r.description for r in bank_rows(result)] == ["A"]
    assert result.warnings == []


def test_explicit_header_row_and_stop_at_end_skips_rows_that_are_not_movements() -> None:
    data = make_csv(
        "lixo",
        "Data;Descrição;Montante;Saldo",
        "01-01-2026;A;10,00;10,00",
        "",
        "Total;;;",
        "02-01-2026;B;5,00;15,00",
    )
    spec = make_spec(table={"headerRow": 1, "stopAt": "end"})
    result = parse(spec, data)
    assert [r.description for r in bank_rows(result)] == ["A", "B"]
    assert any("1 rows were not movements" in w for w in result.warnings)


def test_stop_at_no_date() -> None:
    data = make_csv(
        "Data;Descrição;Montante;Saldo",
        "01-01-2026;A;10,00;10,00",
        "Total;;;",
        "02-01-2026;B;5,00;15,00",
    )
    result = parse(make_spec(table={"findHeader": True, "stopAt": "no-date"}), data)
    assert [r.description for r in bank_rows(result)] == ["A"]


def test_description_filters_skip_rows() -> None:
    spec = make_spec(filters={"skipIfDescriptionMatches": ["(?i)^saldo", "(?i)salário"]})
    result = parse(spec, GENERIC_CSV)
    assert [r.description for r in bank_rows(result)] == ["Café Central"]


def test_a_catastrophic_filter_pattern_times_out_instead_of_hanging() -> None:
    slow = Settings(secret=SECRET, regex_timeout_seconds=0.2)
    data = make_csv("Data;Descrição;Montante;Saldo", f"01-01-2026;{'a' * 40}!;1,00;1,00")
    spec = make_spec(filters={"skipIfDescriptionMatches": ["^(a|aa)+$"]})
    with pytest.raises(ParserError, match="too long"):
        SpecParser(spec, slow).parse(sniff(data, slow))


def test_a_missing_column_is_named_without_echoing_the_file() -> None:
    spec = make_spec(columns={"date": "Data", "description": "Descrição", "amount": "Valor"})
    with pytest.raises(ParseFailedError, match='"Valor"'):
        parse(spec, GENERIC_CSV)


def test_a_file_without_movements_fails() -> None:
    with pytest.raises(ParseFailedError):
        parse(make_spec(), make_csv("Data;Descrição;Montante;Saldo", "Total;;;"))


def test_xlsx_with_a_named_sheet_a_header_row_and_real_dates() -> None:
    sheets: dict[str, list[list[object]]] = {
        "Capa": [["x"]],
        "Movimentos": [
            ["BPI Net"],
            [],
            ["Data Mov.", "Descrição", "Valor", "Saldo"],
            ["01-02-2026", "TRF DE FULANO", 25.0, 125.0],
            [datetime(2026, 2, 2), "COMPRA", -5.5, 119.5],
            [],
            ["Nota: ..."],
        ],
    }
    spec = make_spec(
        fingerprint={"type": "xlsx", "sheet": "Movimentos", "headers": ["Data Mov.", "Valor"]},
        table={"findHeader": True},
        columns={
            "date": "Data Mov.",
            "description": "Descrição",
            "amount": "Valor",
            "balance": "Saldo",
        },
        formats={"date": "dd-mm-yyyy"},
    )
    result = parse(spec, make_xlsx(sheets))
    assert [(r.date, r.amount) for r in bank_rows(result)] == [
        ("2026-02-01", "25"),
        ("2026-02-02", "-5.5"),
    ]
    assert result.meta.reconciled is True


def test_a_sheet_that_is_not_there_fails() -> None:
    spec = make_spec(fingerprint={"type": "xlsx", "sheet": "Nope", "headers": ["Data"]})
    with pytest.raises(ParseFailedError):
        parse(spec, make_xlsx({"Other": [["Data"]]}))


def test_external_id_column() -> None:
    data = make_csv("Data;Descrição;Montante;Saldo;Ref", "01-01-2026;A;10,00;10,00;R-1")
    spec = make_spec(
        fingerprint={"type": "csv", "headers": ["Data", "Descrição"]},
        columns={
            "date": "Data",
            "description": "Descrição",
            "amount": "Montante",
            "ext_id": "Ref",
        },
    )
    assert parse(spec, data).rows[0].external_id == "R-1"


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        (["Data", "Descrição", "Montante", "Saldo"], 0.95),
        (["Data", "Descrição", "Montante", "Outra"], 0.5),
        (["Data", "Descrição"], 0.0),
        (["Foo", "Bar"], 0.0),
    ],
)
def test_detect_scores_the_header_similarity(headers: list[str], expected: float) -> None:
    data = make_csv(";".join(headers), "01-01-2026;A;1,00;1,00")
    score = SpecParser(make_spec()).detect(sniff(data, SETTINGS))
    assert score == pytest.approx(expected, abs=0.01)


def test_detect_ignores_other_file_types_and_sheets() -> None:
    parser = SpecParser(make_spec())
    assert (
        parser.detect(
            sniff(make_xlsx({"S": [["Data", "Descrição", "Montante", "Saldo"]]}), SETTINGS)
        )
        == 0.0
    )
    xlsx = make_spec(fingerprint={"type": "xlsx", "sheet": "Mov", "headers": ["Data"]})
    other_sheet = sniff(make_xlsx({"S": [["Data"]]}), SETTINGS)
    assert SpecParser(xlsx).detect(other_sheet) == 0.0


@pytest.mark.parametrize(
    ("cell", "fmt", "expected"),
    [
        ("05-01-2026", "dd-mm-yyyy", "2026-01-05"),
        ("5/1/2026", "dd/mm/yyyy", "2026-01-05"),
        ("01/05/2026", "mm/dd/yyyy", "2026-01-05"),
        ("2026-01-05", "yyyy-mm-dd", "2026-01-05"),
        ("05.01.26", "dd-mm-yy", None),
        ("05-01-26", "dd-mm-yy", "2026-01-05"),
        ("31-02-2026", "dd-mm-yyyy", None),
        ("not a date", "dd-mm-yyyy", None),
        ("05-01-2026 10:30", "dd-mm-yyyy", "2026-01-05"),
        (datetime(2026, 1, 5, 9, 0), "dd-mm-yyyy", "2026-01-05"),
        (46027, "dd-mm-yyyy", "2026-01-05"),
        (None, "dd-mm-yyyy", None),
    ],
)
def test_read_date(cell: object, fmt: Any, expected: str | None) -> None:
    assert read_date(cell, fmt) == expected


@pytest.mark.parametrize(
    ("cell", "formats", "expected"),
    [
        ("1.234,56", {}, "1234.56"),
        ("-1.234,56", {}, "-1234.56"),
        ("1,234.56", {"decimal": ".", "thousands": ","}, "1234.56"),
        ("1 234,56 €", {"thousands": " "}, "1234.56"),
        ("(12,00)", {"negative": "parentheses"}, "-12"),
        ("12,50-", {}, "-12.5"),
        (12.5, {}, "12.5"),
        ("12,5", {"decimal": ".", "thousands": ","}, None),
        ("abc", {}, None),
        ("1,2,3", {}, None),
        ("", {}, None),
        (None, {}, None),
        (True, {}, None),
    ],
)
def test_read_number(cell: object, formats: dict[str, str], expected: str | None) -> None:
    parsed = read_number(cell, Formats.model_validate({"date": "dd-mm-yyyy", **formats}))
    assert (None if parsed is None else format(parsed, "f")) == expected


def test_decimals_are_exact() -> None:
    parsed = read_number("0,10", Formats.model_validate({"date": "dd-mm-yyyy"}))
    assert parsed == Decimal("0.1")


# ---------------------------------------------------------------- HTTP endpoints


def spec_header(spec: dict[str, Any] | ImportSpec) -> dict[str, str]:
    document = spec.model_dump(by_alias=True, mode="json") if isinstance(spec, ImportSpec) else spec
    encoded = base64.urlsafe_b64encode(json.dumps(document).encode()).decode().rstrip("=")
    return {**AUTH, "X-Import-Spec": encoded}


def test_propose_guesses_a_mapping_that_parses_and_reconciles(client: TestClient) -> None:
    response = client.post("/propose", content=GENERIC_CSV, headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["header"] == ["Data", "Descrição", "Montante", "Saldo"]
    columns = {k: v for k, v in body["spec"]["columns"].items() if v is not None}
    assert columns == {
        "date": "Data",
        "description": "Descrição",
        "amount": "Montante",
        "balance": "Saldo",
    }
    assert body["spec"]["formats"]["date"] == "dd-mm-yyyy"
    assert body["spec"]["formats"]["decimal"] == ","
    assert body["spec"]["fingerprint"]["delimiter"] == ";"
    assert body["preview"]["meta"]["reconciled"] is True
    assert len(body["preview"]["rows"]) == 3


def test_propose_handles_debit_and_credit_and_a_dot_decimal(client: TestClient) -> None:
    data = make_csv(
        "Date,Description,Debit,Credit,Balance",
        "2026-02-01,Rent,500.00,,1500.00",
        "2026-02-02,Pay,,2000.00,3500.00",
    )
    body = client.post("/propose", content=data, headers=AUTH).json()
    assert body["spec"]["columns"]["debit"] == "Debit"
    assert body["spec"]["formats"] == {
        "date": "yyyy-mm-dd",
        "decimal": ".",
        "thousands": ",",
        "negative": "debitColumn",
    }
    assert [r["amount"] for r in body["preview"]["rows"]] == ["-500", "2000"]


def test_propose_limits_the_preview(client: TestClient) -> None:
    lines = ["Data;Descrição;Montante", *[f"01-01-2026;M{i};1,00" for i in range(50)]]
    body = client.post("/propose", content=make_csv(*lines), headers=AUTH).json()
    assert len(body["preview"]["rows"]) == 20
    assert body["preview"]["meta"]["row_count"] == 50


def test_propose_refuses_what_it_cannot_guess(client: TestClient) -> None:
    response = client.post("/propose", content=make_csv("a;b;c", "1;2;3"), headers=AUTH)
    assert response.status_code == 422
    assert response.json()["code"] == "parse_failed"


def test_propose_refuses_a_pdf(client: TestClient) -> None:
    from .support.files import make_pdf

    assert client.post("/propose", content=make_pdf(["x"]), headers=AUTH).status_code == 415


def test_the_confirmed_mapping_is_reused_on_the_next_import(client: TestClient) -> None:
    proposal = client.post("/propose", content=GENERIC_CSV, headers=AUTH).json()
    next_month = make_csv(
        "Data;Descrição;Montante;Saldo",
        "05-02-2026;Padaria;-3,00;995,80",
        encoding="cp1252",
    )
    response = client.post("/parse-spec", content=next_month, headers=spec_header(proposal["spec"]))
    assert response.status_code == 200
    assert response.json()["rows"][0]["description"] == "Padaria"


def test_a_user_can_change_a_column_before_confirming(client: TestClient) -> None:
    proposal = client.post("/propose", content=GENERIC_CSV, headers=AUTH).json()
    proposal["spec"]["columns"]["description"] = "Montante"
    response = client.post(
        "/parse-spec", content=GENERIC_CSV, headers=spec_header(proposal["spec"])
    )
    assert response.json()["rows"][0]["description"] == "-1,20"


@pytest.mark.parametrize(
    "bad",
    [
        {"nonsense": True},
        {**json.loads(json.dumps(make_spec().model_dump(by_alias=True, mode="json"))), "extra": 1},
    ],
)
def test_parse_spec_rejects_an_invalid_spec_without_echoing_it(
    client: TestClient, bad: dict[str, Any]
) -> None:
    response = client.post("/parse-spec", content=GENERIC_CSV, headers=spec_header(bad))
    assert response.status_code == 422
    assert response.json() == {"code": "invalid_spec", "message": "The import spec is not valid."}


def test_parse_spec_rejects_a_header_that_is_not_base64_json(client: TestClient) -> None:
    for value in ("%%%", base64.urlsafe_b64encode(b"[1,2]").decode()):
        response = client.post(
            "/parse-spec", content=GENERIC_CSV, headers={**AUTH, "X-Import-Spec": value}
        )
        assert response.json()["code"] == "invalid_spec"


def test_engine_endpoints_need_the_secret(client: TestClient) -> None:
    assert client.post("/propose", content=GENERIC_CSV).status_code == 401
    spec = make_spec().model_dump(by_alias=True, mode="json")
    headers = {k: v for k, v in spec_header(spec).items() if k != "X-Parser-Secret"}
    assert client.post("/parse-spec", content=GENERIC_CSV, headers=headers).status_code == 401


def test_parse_spec_has_the_file_size_limit(client: TestClient, settings: Settings) -> None:
    big = b"a" * (settings.max_file_bytes + 1)
    spec = make_spec().model_dump(by_alias=True, mode="json")
    assert client.post("/parse-spec", content=big, headers=spec_header(spec)).status_code == 413
