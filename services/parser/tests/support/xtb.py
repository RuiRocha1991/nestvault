"""A generated XTB report (fake instruments, no real data) with the sheets and columns of the real
export. Reference values: cash 11,25 US$, gross dividends 70,75, withholding tax -10,69, tax
refund +4,24, deposits 1 284,39."""

from datetime import datetime

from .files import make_xlsx

ACCOUNT = "50000001"
GENERATED = datetime(2026, 10, 10, 12, 49, 17)
HEADER: list[object] = [
    "Type",
    "Instrument",
    "Ticker",
    "Category",
    "Time",
    "Amount",
    "ID",
    "Comment",
    "Product",
]
INSTRUMENTS = {
    "AAA.US": "Alpha Exemplo",
    "BBB.US": "Beta Exemplo",
    "CCC.US": "Gamma Exemplo",
}
DIVIDENDS = [  # symbol, day, gross, withholding
    ("AAA.US", 5, "20.00", "-3.00"),
    ("BBB.US", 5, "15.00", "-2.25"),
    ("CCC.US", 6, "10.00", "-1.50"),
    ("AAA.US", 12, "8.50", "-1.28"),
    ("BBB.US", 12, "6.25", "-0.94"),
    ("CCC.US", 13, "4.00", "-0.60"),
    ("AAA.US", 19, "3.00", "-0.45"),
    ("BBB.US", 19, "2.00", "-0.30"),
    ("CCC.US", 20, "1.50", "-0.22"),
    ("AAA.US", 26, "0.50", "-0.15"),
]
GROSS = "70.75"
WITHHOLDING = "-10.69"
REFUND = "4.24"
DEPOSITS = "1284.39"
TOTAL = "11.25"
BUYS = [  # symbol, quantity, price, amount
    ("AAA.US", "50", "10.00", -500.00),
    ("BBB.US", "20", "20.00", -400.00),
    ("CCC.US", "3", "145.82", -437.46),
]


POSITIONS_HEADER: list[object] = [
    *["Product", "Instrument/Position", "Ticker", "Category", "Type", "Volume", "Value"],
    *["Current price", "Open price", "Open time (UTC)"],
]


def _op(
    kind: str,
    when: datetime,
    amount: float,
    op_id: str,
    comment: str,
    symbol: str = "",
    position: str = "",
) -> list[object]:
    name = INSTRUMENTS.get(symbol, "")
    category = "STOCK" if symbol else ""
    return [kind, name, symbol, category, when, amount, op_id, comment, "My Trades", position]


def cash_rows() -> list[list[object]]:
    rows: list[list[object]] = []
    for number, (symbol, day, gross, tax) in enumerate(DIVIDENDS):
        when = datetime(2026, 9, day, 8, 16, 30)
        rows.append(
            _op(
                "Dividend",
                when,
                float(gross),
                str(1000 + number * 2),
                f"{symbol} USD 0.09/ SHR",
                symbol,
            )
        )
        rows.append(
            _op(
                "Withholding tax",
                when,
                float(tax),
                str(1001 + number * 2),
                f"{symbol} USD WHT 15%",
                symbol,
            )
        )
    refund_when = datetime(2026, 9, 28, 9, 0, 0)
    rows.append(
        _op("Withholding tax", refund_when, float(REFUND), "2000", "AAA.US WHT refund", "AAA.US")
    )
    for number, (symbol, quantity, price, amount) in enumerate(BUYS):
        when = datetime(2026, 8, 3 + number, 14, 30, 29)
        comment = f"OPEN BUY {quantity} @ {price}"
        rows.append(
            _op(
                "Stock purchase",
                when,
                amount,
                str(3000 + number),
                comment,
                symbol,
                str(9000 + number),
            )
        )
    conversion = "Currency conversion, EUR to USD, Exchange rate:1.17"
    rows.append(_op("Transfer", datetime(2026, 1, 2, 13, 24, 2), 1000.00, "4000", conversion))
    rows.append(_op("Transfer", datetime(2026, 2, 2, 16, 26, 0), 284.39, "4001", conversion))
    month = datetime(2026, 9, 3, 11, 45)
    rows.append(_op("Free funds interest", month, 0.09, "5000", "Free-funds Interest 2026-08"))
    rows.append(
        _op("Free funds interest tax", month, -0.07, "5001", "Free-funds Interest TAX 2026-08")
    )
    return rows


def workbook(
    cash: list[list[object]] | None = None,
    total: float = float(TOTAL),
    currency: str | None = "USD",
) -> dict[str, list[list[object]]]:
    operations = cash_rows() if cash is None else cash
    positions: list[list[object]] = [
        ["Account number", ACCOUNT],
        ["Open Positions", ""],
        ["Data as of report generated", GENERATED],
        ["Product", "Metric", "Amount", "Currency"],
        ["My Trades", "Open position value", 1350.62, currency],
        [],
        ["Note", "Summary values and open positions are shown as of the report generation time"],
        POSITIONS_HEADER,
    ]
    for symbol, quantity, price, _amount in BUYS:
        current = float(price) + 1
        name = INSTRUMENTS[symbol]
        positions.append(
            [
                *["My Trades", name, symbol, "STOCK", "BUY", float(quantity), 100.0, current],
                float(price),
                GENERATED,
            ]
        )
    return {
        "Closed Positions": [["Account number", ACCOUNT], ["Closed Positions", ""]],
        "Cash Operations": [
            ["Account number", ACCOUNT],
            ["Cash Operations", ""],
            ["Date from (UTC)", datetime(2025, 12, 1)],
            ["Date to (UTC)", GENERATED],
            HEADER,
            *operations,
            ["Total", None, None, None, None, total],
        ],
        "Open Positions": positions,
    }


def xtb_xlsx(**kwargs: object) -> bytes:
    return make_xlsx(workbook(**kwargs))  # type: ignore[arg-type]
