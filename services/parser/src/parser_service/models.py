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
    type: Literal[
        "buy", "sell", "dividend", "tax", "refund", "deposit", "withdrawal", "fee", "interest"
    ]
    symbol: Text | None = None
    name: Text | None = None  # instrument name, to create a missing asset in the preview
    quantity: Decimal_ | None = None
    price: Decimal_ | None = None
    amount: Decimal_
    currency: Currency
    holder: Text | None = None
    external_id: Text | None = None
    # Investment CSV extras: the sub-account and asset class named in the file, the commission and
    # the tax withheld (dividends). The import links `subaccount` to the account's sub-accounts.
    subaccount: Text | None = None
    asset_type: Text | None = None
    fee: Decimal_ | None = None
    tax: Decimal_ | None = None


Row = Annotated[BankRow | BrokerRow, Field(discriminator="kind")]


class PriceEntry(_Strict):
    """A quote the file states (for example the fund price on the report date)."""

    symbol: Text
    date: IsoDate
    price: Decimal_
    currency: Currency


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
    account_hint: Text | None = None  # the account number the file states, to pick the account
    # Distinct sub-account names the file mentions, so the preview can flag the unknown ones.
    subaccounts: list[Text] = Field(default_factory=list)


class ParseResponse(_Strict):
    rows: list[Row]
    meta: ParseMeta
    warnings: list[Text]
    prices: list[PriceEntry] = Field(default_factory=list)


class DetectResponse(_Strict):
    results: list[DetectResult]


class ParsersResponse(_Strict):
    parsers: list[ParserInfo]


class ErrorResponse(_Strict):
    code: str
    message: str
