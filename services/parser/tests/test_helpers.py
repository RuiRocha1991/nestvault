import json
from pathlib import Path

import pytest

from parser_service.helpers import normalize_text, parse_date, parse_num

VECTORS = json.loads(
    (Path(__file__).resolve().parent.parent / "schemas" / "test-vectors.json").read_text("utf-8")
)


@pytest.mark.parametrize("case", VECTORS["parseNum"], ids=lambda c: repr(c["input"]))
def test_parse_num_vectors(case: dict[str, object]) -> None:
    assert parse_num(case["input"]) == case["expected"]  # type: ignore[arg-type]


@pytest.mark.parametrize("case", VECTORS["parseDate"], ids=lambda c: repr(c["input"]))
def test_parse_date_vectors(case: dict[str, object]) -> None:
    assert parse_date(case["input"]) == case["expected"]  # type: ignore[arg-type]


@pytest.mark.parametrize("case", VECTORS["normalizeText"], ids=lambda c: repr(c["input"]))
def test_normalize_text_vectors(case: dict[str, object]) -> None:
    assert normalize_text(case["input"]) == case["expected"]  # type: ignore[arg-type]


def test_non_finite_numbers_are_rejected() -> None:
    assert parse_num(float("nan")) is None
    assert parse_num(float("inf")) is None
    assert parse_date(float("nan")) is None


def test_booleans_are_not_numbers() -> None:
    assert parse_num(True) is None
    assert parse_date(True) is None
