import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from parser_service.engine.spec import ImportSpec, load_specs, spec_schema
from parser_service.registry import SPECS_DIR, default_registry

BASE: dict[str, Any] = {
    "id": "example-csv",
    "version": 1,
    "kind": "bank",
    "fingerprint": {"type": "csv", "headers": ["Data", "Descrição", "Valor"], "delimiter": ";"},
    "table": {"findHeader": True, "stopAt": "empty-row"},
    "columns": {"date": "Data", "description": "Descrição", "amount": "Valor", "balance": "Saldo"},
    "formats": {"date": "dd-mm-yyyy", "decimal": ",", "thousands": ".", "negative": "sign"},
    "filters": {"skipIfDescriptionMatches": ["^SALDO"]},
}


def spec(**changes: Any) -> dict[str, Any]:
    document = copy.deepcopy(BASE)
    for key, value in changes.items():
        document[key] = value
    return document


def test_a_valid_spec_loads_and_round_trips_with_its_json_names() -> None:
    loaded = ImportSpec.model_validate(BASE)
    dumped = loaded.model_dump(by_alias=True, mode="json")
    assert dumped["table"]["stopAt"] == "empty-row"
    assert dumped["columns"]["description"] == "Descrição"
    assert ImportSpec.model_validate(dumped) == loaded


@pytest.mark.parametrize(
    "bad",
    [
        spec(unknown="x"),
        spec(fingerprint={**BASE["fingerprint"], "extra": 1}),
        spec(columns={**BASE["columns"], "extra": "x"}),
        spec(formats={**BASE["formats"], "extra": "x"}),
        spec(filters={"skipIfDescriptionMatches": [], "extra": 1}),
        spec(table={"unknown": True}),
        spec(columns={**BASE["columns"], "description": "x" * 10_000}),
        spec(fingerprint={"type": "csv", "headers": ["x" * 10_000]}),
        spec(filters={"skipIfDescriptionMatches": ["a" * 201]}),
        spec(filters={"skipIfDescriptionMatches": ["a"] * 21}),
        spec(id="Has Spaces"),
        spec(id="x" * 65),
        spec(version=0),
        spec(kind="broker"),
        spec(schemaVersion=2),
        spec(fingerprint={"type": "csv", "headers": []}),
        spec(fingerprint={"type": "csv", "headers": ["a"], "sheet": "S"}),
        spec(fingerprint={"type": "xlsx", "headers": ["a"], "delimiter": ";"}),
        spec(table={"headerRow": 3, "findHeader": True}),
        spec(columns={"date": "a", "description": "b"}),
        spec(columns={"date": "a", "description": "b", "amount": "c", "debit": "d", "credit": "e"}),
        spec(columns={"date": "a", "description": "b", "debit": "d"}),
        spec(formats={"date": "dd-mm-yyyy", "decimal": ",", "thousands": ","}),
        spec(formats={"date": "yy-yy", "decimal": ","}),
        spec(formats={**BASE["formats"], "negative": "debitColumn"}),
        spec(
            columns={"date": "a", "description": "b", "debit": "d", "credit": "e"},
        ),
    ],
)
def test_a_spec_outside_the_schema_is_rejected(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        ImportSpec.model_validate(bad)


def test_debit_and_credit_columns_need_the_debit_column_sign_rule() -> None:
    document = spec(
        columns={"date": "a", "description": "b", "debit": "d", "credit": "e"},
        formats={**BASE["formats"], "negative": "debitColumn"},
    )
    assert ImportSpec.model_validate(document).columns.credit == "e"


def test_the_json_schema_is_closed_everywhere() -> None:
    schema = spec_schema()
    assert schema["additionalProperties"] is False
    definitions = schema["$defs"]
    assert isinstance(definitions, dict)
    assert definitions
    assert all(
        d.get("additionalProperties") is False for d in definitions.values() if "properties" in d
    )


def test_the_json_schema_file_is_current() -> None:
    path = Path(__file__).resolve().parent.parent / "schemas" / "import-spec.schema.json"
    assert json.loads(path.read_text(encoding="utf-8")) == spec_schema()


def test_shipped_specs_validate_and_have_unique_ids() -> None:
    specs = load_specs(SPECS_DIR)
    assert len({s.id for s in specs}) == len(specs)
    registered = {p.id for p in default_registry().all()}
    assert {s.id for s in specs} <= registered


def test_a_broken_spec_file_stops_the_loader(tmp_path: Path) -> None:
    (tmp_path / "bad.json").write_text(json.dumps(spec(unknown=1)), encoding="utf-8")
    with pytest.raises(ValidationError):
        load_specs(tmp_path)


def test_duplicate_spec_ids_stop_the_loader(tmp_path: Path) -> None:
    for name in ("a.json", "b.json"):
        (tmp_path / name).write_text(json.dumps(BASE), encoding="utf-8")
    with pytest.raises(ValueError, match="Duplicate"):
        load_specs(tmp_path)


def test_an_empty_folder_gives_no_specs(tmp_path: Path) -> None:
    assert load_specs(tmp_path) == []
