"""Import spec schema v1. Everything is strict (`extra="forbid"`) and bounded: a spec is data
that may come from a user or a model, so anything outside this schema is rejected, never ignored.
"""

import json
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel

SCHEMA_VERSION: Literal[1] = 1
SpecId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")]
# A header text or a sheet name: short, so a 10 000-character string is refused.
Label = Annotated[str, StringConstraints(min_length=1, max_length=100)]
FilterPattern = Annotated[str, StringConstraints(min_length=1, max_length=200)]
DateFormat = Literal[
    "dd-mm-yyyy",
    "dd/mm/yyyy",
    "dd.mm.yyyy",
    "yyyy-mm-dd",
    "yyyy/mm/dd",
    "mm/dd/yyyy",
    "dd-mm-yy",
    "dd/mm/yy",
]
MAX_HEADERS = 40
MAX_FILTERS = 20


class _Strict(BaseModel):
    model_config = ConfigDict(
        extra="forbid", alias_generator=to_camel, populate_by_name=True, frozen=True
    )


class Fingerprint(_Strict):
    type: Literal["xlsx", "csv"]
    sheet: Label | None = None
    headers: Annotated[list[Label], Field(min_length=1, max_length=MAX_HEADERS)]
    header_row_hint: Annotated[int, Field(ge=0, le=200)] | None = None
    delimiter: Literal[";", ",", "\t", "|"] | None = None
    encoding: Literal["utf-8", "cp1252"] | None = None

    @model_validator(mode="after")
    def _csv_has_no_sheet(self) -> Self:
        if self.type == "csv" and self.sheet is not None:
            raise ValueError("A csv fingerprint has no sheet.")
        if self.type == "xlsx" and (self.delimiter or self.encoding):
            raise ValueError("delimiter and encoding only apply to csv.")
        return self


class Table(_Strict):
    # 0-based index of the header row; or find it (the default when neither is given).
    header_row: Annotated[int, Field(ge=0, le=200)] | None = None
    find_header: bool = False
    # `empty-row`: stop at the first blank row after the data; `no-date`: stop at the first row
    # whose date cannot be read; `end`: read to the end and skip rows that are not movements.
    stop_at: Literal["empty-row", "no-date", "end"] = "empty-row"

    @model_validator(mode="after")
    def _one_way_to_find_the_header(self) -> Self:
        if self.header_row is not None and self.find_header:
            raise ValueError("Give headerRow or findHeader, not both.")
        return self


class Columns(_Strict):
    date: Label
    description: Label
    amount: Label | None = None
    debit: Label | None = None
    credit: Label | None = None
    balance: Label | None = None
    value_date: Label | None = None
    ext_id: Label | None = None

    @model_validator(mode="after")
    def _amount_or_debit_and_credit(self) -> Self:
        two_columns = self.debit is not None and self.credit is not None
        if (self.amount is None) == (not two_columns):
            raise ValueError("Give either amount, or both debit and credit.")
        if (self.debit is None) != (self.credit is None):
            raise ValueError("debit and credit go together.")
        return self


class Formats(_Strict):
    date: DateFormat
    decimal: Literal[",", "."] = ","
    thousands: Literal[".", ",", " ", ""] = "."
    # `sign`: a leading minus; `parentheses`: (12,00) is negative too; `debitColumn`: amounts come
    # from separate debit and credit columns, both written as positive numbers.
    negative: Literal["sign", "parentheses", "debitColumn"] = "sign"

    @model_validator(mode="after")
    def _separators_differ(self) -> Self:
        if self.decimal == self.thousands:
            raise ValueError("decimal and thousands must differ.")
        return self


class Filters(_Strict):
    skip_if_description_matches: Annotated[list[FilterPattern], Field(max_length=MAX_FILTERS)] = (
        Field(default_factory=list)
    )


class ImportSpec(_Strict):
    schema_version: Literal[1] = SCHEMA_VERSION
    id: SpecId
    version: Annotated[int, Field(ge=1, le=1000)]
    kind: Literal["bank"]
    fingerprint: Fingerprint
    table: Table = Field(default_factory=Table)
    columns: Columns
    formats: Formats
    filters: Filters = Field(default_factory=Filters)

    @model_validator(mode="after")
    def _negative_matches_columns(self) -> Self:
        two_columns = self.columns.amount is None
        if (self.formats.negative == "debitColumn") != two_columns:
            raise ValueError("negative=debitColumn needs debit and credit columns, and vice versa.")
        return self


def spec_schema() -> dict[str, object]:
    schema = ImportSpec.model_json_schema(by_alias=True, mode="validation")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = f"https://nestvault.local/schemas/import-spec.v{SCHEMA_VERSION}.json"
    return schema


def load_spec_file(path: Path) -> ImportSpec:
    return ImportSpec.model_validate(json.loads(path.read_text(encoding="utf-8")))


def load_specs(directory: Path) -> list[ImportSpec]:
    """Every `*.json` in the folder, validated. A broken spec stops start-up: shipping an
    invalid spec is a bug to see at once, not a parser that silently never matches."""
    specs = [load_spec_file(path) for path in sorted(directory.glob("*.json"))]
    ids = [spec.id for spec in specs]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate spec id in the specs folder.")
    return specs
