import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from parser_service.models import BankRow, BrokerRow

ROOT = Path(__file__).resolve().parent.parent


def test_generated_schema_is_up_to_date() -> None:
    result = subprocess.run(  # noqa: S603
        [sys.executable, str(ROOT / "scripts" / "export_schema.py"), "--check"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout


@pytest.mark.parametrize(
    "bad",
    [
        {"kind": "bank", "date": "05/01/2026", "description": "x", "amount": "1"},
        {"kind": "bank", "date": "2026-01-05", "description": "x", "amount": "1,5"},
        {"kind": "bank", "date": "2026-01-05", "description": "x", "amount": 1.5},
        {"kind": "bank", "date": "2026-01-05", "description": "x", "amount": "1", "extra": 1},
        {"kind": "bank", "date": "2026-01-05", "description": "x" * 501, "amount": "1"},
    ],
)
def test_bank_row_rejects_malformed_values(bad: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        BankRow.model_validate(bad)


def test_broker_row_requires_currency_and_known_type() -> None:
    good = {
        "kind": "broker",
        "date": "2026-01-05",
        "type": "buy",
        "amount": "-10",
        "currency": "EUR",
    }
    BrokerRow.model_validate(good)
    for change in ({"currency": "eur"}, {"type": "gift"}):
        with pytest.raises(ValidationError):
            BrokerRow.model_validate({**good, **change})
