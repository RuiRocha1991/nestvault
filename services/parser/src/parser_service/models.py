"""Wire models. `schemas/rows.schema.json` is generated from these (`scripts/export_schema.py`)
and Node generates its zod schema from that file, so both sides share one definition."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

IsoDate = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]
Decimal_ = Annotated[str, StringConstraints(pattern=r"^-?\d+(\.\d+)?$", max_length=40)]
Text = Annotated[str, StringConstraints(max_length=500)]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]
ParserKind = Literal["bank", "broker"]
BankRowType = Literal["transfer", "card", "interest", "trade", "dividend", "fee", "other"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BankRow(_Strict):
    kind: Literal["bank"]
    date: IsoDate
    description: Text
    amount: Decimal_
    balance: Decimal_ | None = None
    external_id: Text | None = None
    # What the statement says the movement is, when it says so. `interest` feeds `deposits.link`.
    type: BankRowType | None = None


class BrokerRow(_Strict):
    kind: Literal["broker"]
    date: IsoDate
    type: Literal["buy", "sell", "dividend", "tax", "refund", "deposit", "withdrawal", "fee"]
    symbol: Text | None = None
    quantity: Decimal_ | None = None
    price: Decimal_ | None = None
    amount: Decimal_
    currency: Currency
    holder: Text | None = None
    external_id: Text | None = None


Row = Annotated[BankRow | BrokerRow, Field(discriminator="kind")]


class DetectResult(_Strict):
    parser_id: str
    kind: ParserKind
    version: str
    confidence: Annotated[float, Field(ge=0, le=1)]


class ParserInfo(_Strict):
    id: str
    kind: ParserKind
    version: str


class ParseMeta(_Strict):
    parser_id: str
    parser_version: str
    row_count: int
    opening_balance: Decimal_ | None = None
    closing_balance: Decimal_ | None = None
    reconciled: bool | None = None


class ParseResponse(_Strict):
    rows: list[Row]
    meta: ParseMeta
    warnings: list[Text]


class DetectResponse(_Strict):
    results: list[DetectResult]


class ParsersResponse(_Strict):
    parsers: list[ParserInfo]


class ErrorResponse(_Strict):
    code: str
    message: str
