"""A generated Banco Invest "Posição Actual" workbook (fake holders, no real data) with the layout
of the real file. Quote 8,017 €; units, market values and invested amounts are the reference
values of the task."""

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from .files import make_xlsx

QUOTE = Decimal("8.017")
TITLE = "Invest Tendências Globais - Posição Actual"
# first name, units, invested
HOLDERS = [
    ("SIMÃO EXEMPLO SILVA", Decimal("504.8609"), Decimal("3746.42")),
    ("VICENTE EXEMPLO SILVA", Decimal("309.5371"), Decimal("2320.00")),
    ("RUI EXEMPLO SILVA", Decimal("1234.9144"), Decimal("8500.24")),
    ("LILIANA EXEMPLO SILVA", Decimal("596.7909"), Decimal("4500.00")),
]
MARKET = {"Rui": "9900.31", "Liliana": "4784.47", "Simão": "4047.47", "Vicente": "2481.56"}
INVESTED_TOTAL = Decimal("19066.66")
MARKET_TOTAL = Decimal("21213.81")
_CENT = Decimal("0.0001")


def lots_for(units: Decimal, invested: Decimal) -> list[tuple[str, datetime, Decimal, Decimal]]:
    """Three lots that add up to `units` and (to a cent) `invested`."""
    first = (units * Decimal("0.5")).quantize(_CENT, ROUND_HALF_UP)
    second = (units * Decimal("0.3")).quantize(_CENT, ROUND_HALF_UP)
    third = units - first - second
    p1, p2 = Decimal("7.0000"), Decimal("7.5000")
    p3 = ((invested - first * p1 - second * p2) / third).quantize(_CENT, ROUND_HALF_UP)
    return [
        ("Subscrição", datetime(2024, 9, 4), first, p1),
        ("Subs / T", datetime(2025, 3, 11), second, p2),
        ("Subscrição", datetime(2026, 10, 1), third, p3),
    ]


def workbook_rows(
    holders: list[tuple[str, Decimal, Decimal]] = HOLDERS,
    title: str = TITLE,
    extra_lots: dict[str, list[tuple[str, datetime, Decimal, Decimal]]] | None = None,
) -> list[list[object]]:
    rows: list[list[object]] = [
        [title],
        [datetime(2026, 10, 11, 18, 22, 13)],
        ["CONTA"],
        ["1234567\xa0Longo P"],
        ["MOEDA"],
        ["EUR"],
        ["PRIMEIRO TITULAR"],
        [holders[0][0]],
        [None],
        [title],
        ["TITULAR", "INÍCIO", "QTD", "P.M.S", "COTAÇÃO", "VAR %", "VAR MOEDA", "VALOR"],
    ]
    lots = {name: lots_for(units, invested) for name, units, invested in holders}
    for name, lot_list in (extra_lots or {}).items():
        lots[name] = lots[name] + lot_list
    for name, _units, _invested in holders:
        units = sum((lot[2] for lot in lots[name]), Decimal(0))
        cost = sum((lot[2] * lot[3] for lot in lots[name]), Decimal(0))
        value = (units * QUOTE).quantize(Decimal("0.01"), ROUND_HALF_UP)
        rows.append(
            [name, datetime(2024, 9, 4), float(units), float(cost / units), float(QUOTE),
             1.0, 1.0, float(value)]
        )  # fmt: skip
    rows.append(["Investimentos (por lote)"])
    for name, _units, _invested in holders:
        rows.append([name])
        rows.append(["TIPO", "DATA", "QTD", "VALOR SUBSCRIÇÃO", "+- VALIA", "TEMPO (ANOS)"])
        for kind, day, quantity, price in lots[name]:
            rows.append([kind, day, float(quantity), float(price), 1.0, 0.1])
    rows.append(["www.bancoinvest.pt"])
    return rows


def banco_invest_xlsx(**kwargs: object) -> bytes:
    return make_xlsx({"Folha 1": workbook_rows(**kwargs)})  # type: ignore[arg-type]
