"""Wire models of the real estate parsers. `schemas/real-estate.schema.json` is generated from
`RealEstateParseResponse` (`scripts/export_schema.py`) and Node generates its zod schema from it."""

from typing import Annotated, Literal

from pydantic import Field

from ..models import Decimal_, IsoDate, Text, _Strict

WorkStatus = Literal["planned", "in_progress", "done"]
PaymentStatus = Literal["planned", "paid"]
SheetAction = Literal["import", "recalculated"]


class InstallmentRow(_Strict):
    kind: Literal["installment"]
    number: Annotated[int, Field(ge=1, le=600)]
    due_date: IsoDate
    capital: Decimal_
    interest: Decimal_
    fees: Decimal_ = "0"
    stamp_tax: Decimal_ = "0"
    life_insurance: Decimal_ = "0"
    home_insurance: Decimal_ = "0"
    credit_insurance: Decimal_ = "0"


class PrepaymentRow(_Strict):
    kind: Literal["prepayment"]
    date: IsoDate
    amount: Decimal_
    fee: Decimal_ | None = None


class WorkRow(_Strict):
    kind: Literal["work"]
    name: Text
    supplier: Text | None = None
    budget: Decimal_
    deposit_pct: Decimal_ | None = None
    status: WorkStatus = "planned"
    start_date: IsoDate | None = None
    planned_end: IsoDate | None = None


class WorkPaymentRow(_Strict):
    kind: Literal["work_payment"]
    work: Text  # the name of the works project the phase belongs to
    description: Text
    amount: Decimal_
    planned_date: IsoDate | None = None
    paid_date: IsoDate | None = None
    status: PaymentStatus = "planned"


class InflationRow(_Strict):
    kind: Literal["inflation"]
    year: Annotated[int, Field(ge=1900, le=2200)]
    rate_pct: Decimal_


RealEstateRow = Annotated[
    InstallmentRow | PrepaymentRow | WorkRow | WorkPaymentRow | InflationRow,
    Field(discriminator="kind"),
]


class AcquisitionCosts(_Strict):
    deed: Decimal_ = "0"
    imt: Decimal_ = "0"
    stamp_duty: Decimal_ = "0"
    registration: Decimal_ = "0"
    bank_fees: Decimal_ = "0"


class SheetSummary(_Strict):
    """One line of the import dialog: what a sheet holds and what the app does with it."""

    sheet: Text
    label: Text
    rows: int
    action: SheetAction


class RealEstateMeta(_Strict):
    parser_id: str
    parser_version: str
    row_count: int
    acquisition_costs: AcquisitionCosts | None = None
    sheets: list[SheetSummary] = Field(default_factory=list)


class RealEstateParseResponse(_Strict):
    rows: list[RealEstateRow]
    meta: RealEstateMeta
    warnings: list[Text]


class RealEstateDetectResult(_Strict):
    parser_id: str
    version: str
    confidence: Annotated[float, Field(ge=0, le=1)]


class RealEstateDetectResponse(_Strict):
    results: list[RealEstateDetectResult]
