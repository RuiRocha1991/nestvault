import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from .conftest import AUTH
from .support.files import make_csv, make_pdf, make_xlsx

SCHEMA = json.loads(
    (Path(__file__).resolve().parent.parent / "schemas" / "rows.schema.json").read_text("utf-8")
)
BANK_XLSX = make_xlsx(
    {"StubBank": [["Date", "Description", "Amount"], ["2026-01-05", "Coffee", "-1.20"]]}
)
BROKER_PDF = make_pdf(["STUB BROKER account statement", "Dividend AAA 1.50 USD"])


def test_parsers_lists_the_registry(client: TestClient) -> None:
    body = client.get("/parsers", headers=AUTH).json()
    ids = [p["id"] for p in body["parsers"]]
    assert ids == sorted(ids)
    assert {"id": "stub-bank-xlsx", "kind": "bank", "version": "1.0.0"} in body["parsers"]


def test_detect_ranks_by_confidence(client: TestClient) -> None:
    results = client.post("/detect", content=BANK_XLSX, headers=AUTH).json()["results"]
    assert results == [
        {"parser_id": "stub-bank-xlsx", "kind": "bank", "version": "1.0.0", "confidence": 0.95}
    ]


def test_detect_reads_pdf_text(client: TestClient) -> None:
    results = client.post("/detect", content=BROKER_PDF, headers=AUTH).json()["results"]
    assert [r["parser_id"] for r in results] == ["stub-broker-pdf"]


def test_detect_below_threshold_returns_nothing(client: TestClient) -> None:
    other = make_pdf(["Some unrelated document"])
    assert client.post("/detect", content=other, headers=AUTH).json() == {"results": []}


def test_detect_csv_in_latin1(client: TestClient) -> None:
    csv = make_csv("Data;Descrição;Valor", "05/01/2026;Café;-1,20", encoding="cp1252")
    results = client.post("/detect", content=csv, headers=AUTH).json()["results"]
    assert [r["parser_id"] for r in results] == ["stub-csv"]


def test_parse_returns_schema_valid_rows(client: TestClient) -> None:
    response = client.post("/parse?parser_id=stub-bank-xlsx", content=BANK_XLSX, headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["rows"] == [
        {
            "kind": "bank",
            "date": "2026-01-05",
            "description": "Coffee",
            "amount": "-1.20",
            "balance": None,
            "external_id": None,
        }
    ]
    assert body["meta"]["row_count"] == 1
    Draft202012Validator(SCHEMA).validate(body)


def test_parse_broker_rows_match_the_shared_schema(client: TestClient) -> None:
    body = client.post("/parse?parser_id=stub-broker-pdf", content=BROKER_PDF, headers=AUTH).json()
    assert body["rows"][0]["kind"] == "broker"
    assert body["warnings"] == ["stub"]
    Draft202012Validator(SCHEMA).validate(body)


def test_unknown_parser_is_404_before_the_file_is_read(client: TestClient) -> None:
    response = client.post("/parse?parser_id=nope", content=BANK_XLSX, headers=AUTH)
    assert response.status_code == 404
    assert response.json()["code"] == "unknown_parser"


@pytest.mark.parametrize("parser_id", ["", "UPPER", "../x", "a b", "x" * 80])
def test_malformed_parser_id_is_rejected_without_echo(client: TestClient, parser_id: str) -> None:
    response = client.post(f"/parse?parser_id={parser_id}", content=b"a", headers=AUTH)
    assert response.status_code == 422
    assert parser_id not in response.text or parser_id == ""


def test_parser_failure_is_a_clear_422(client: TestClient) -> None:
    response = client.post("/parse?parser_id=stub-csv", content=b"a,b\n1,2\n", headers=AUTH)
    assert response.status_code == 422
    assert response.json() == {"code": "parse_failed", "message": "This stub never parses."}


def test_unexpected_exception_never_leaks_its_message(client: TestClient) -> None:
    response = client.post("/parse?parser_id=stub-exploding", content=b"a,b\n1,2\n", headers=AUTH)
    assert response.status_code == 422
    assert "IBAN" not in response.text
    assert response.json()["code"] == "parse_failed"


def test_malformed_rows_are_never_forwarded(client: TestClient) -> None:
    response = client.post("/parse?parser_id=stub-malformed", content=b"a,b\n1,2\n", headers=AUTH)
    assert response.status_code == 422
    assert "rows" not in response.json()


def test_parse_without_a_body_is_unsupported(client: TestClient) -> None:
    response = client.post("/parse?parser_id=stub-csv", headers=AUTH)
    assert response.status_code == 415
