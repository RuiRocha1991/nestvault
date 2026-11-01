"""A synthetic copy of the owner's mortgage workbook (NES-102).

The real workbook is never stored. This one has the same sheets and columns and the same reference
totals (capital 10 511,72 € in 73 installments plus a 15 000 € prepayment, which the Sumário sheet
includes in the capital of the installment of the prepayment month, as the real workbook does),
interest 14 058,99 €, works 22 071,46 €, acquisition costs 2 559,71 €, credit insurance
225,38 € since 04/2026) with invented names, so the tests can reproduce them.
`python -m tests.support.mortgage` rewrites
`tests/fixtures/mortgage/mortgage-workbook.anonymized.xlsx` from it.
"""

import io
import json
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import openpyxl

CENT = Decimal("0.01")
INSTALLMENTS = 73
CAPITAL_TOTAL = Decimal("10511.72")  # + the 15 000 € prepayment = 25 511,72 €
INTEREST_TOTAL = Decimal("14058.99")
PREPAYMENT = Decimal("15000.00")
PREPAYMENT_DATE = date(2023, 2, 1)
CREDIT_INSURANCE_TOTAL = Decimal("225.38")
WORKS_TOTAL = Decimal("22071.46")
COSTS_TOTAL = Decimal("2559.71")
INFLATION = [("2020", "0"), ("2021", "1.3"), ("2022", "7.8"), ("2023", "4.3"), ("2024", "2.4")]
INFLATION.append(("2025", "2.3"))
ROWS = {"installments": 73, "prepayments": 1, "works": 4, "payments": 8, "inflation": 6}
TOTAL_ROWS = 92

WORKS = [
    # name, supplier, budget, deposit %, start, planned end, [(description, amount, planned, paid)]
    (
        "Kitchen refit",
        "Supplier A",
        "9120.46",
        "30",
        date(2023, 3, 1),
        date(2023, 5, 30),
        [
            ("Deposit", "2736.14", date(2023, 3, 1), date(2023, 3, 3)),
            ("Final payment", "6384.32", date(2023, 5, 30), date(2023, 6, 9)),
        ],
    ),
    (
        "Air conditioning",
        "Supplier B",
        "6350.00",
        "40",
        date(2023, 6, 12),
        date(2023, 7, 14),
        [
            ("Deposit", "2540.00", date(2023, 6, 12), date(2023, 6, 12)),
            ("Final payment", "3810.00", date(2023, 7, 14), date(2023, 7, 20)),
        ],
    ),
    (
        "Bathroom works",
        "Supplier C",
        "4200.00",
        "50",
        date(2023, 9, 4),
        date(2023, 10, 20),
        [
            ("Deposit", "2100.00", date(2023, 9, 4), date(2023, 9, 4)),
            ("Final payment", "2100.00", date(2023, 10, 20), date(2023, 10, 27)),
        ],
    ),
    (
        "Wardrobes",
        "Supplier D",
        "2401.00",
        "25",
        date(2024, 1, 8),
        date(2024, 2, 29),
        [
            ("Deposit", "600.25", date(2024, 1, 8), date(2024, 1, 10)),
            ("Final payment", "1800.75", date(2024, 2, 29), date(2024, 3, 5)),
        ],
    ),
]
COSTS = [
    ("Escritura", "915.00"),
    ("IMT", "631.86"),
    ("Imposto de selo", "992.00"),
    ("Registo predial", "0"),
    ("Despesas bancárias", "20.85"),
]


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _split(total: Decimal, weights: list[int]) -> list[Decimal]:
    """`total` shared by weight in cents; the last share absorbs the rounding."""
    whole = sum(weights)
    shares = [_money(total * weight / whole) for weight in weights]
    shares[-1] = total - sum(shares[:-1])
    return shares


def _due(number: int) -> date:
    months = 2020 * 12 + 8 + (number - 1)  # installment 1 is 09/2020
    return date(months // 12, months % 12 + 1, 5)


def installments() -> list[dict[str, object]]:
    capital = _split(CAPITAL_TOTAL, [100 + n for n in range(1, INSTALLMENTS + 1)])
    interest = _split(INTEREST_TOTAL, [150 + (3 * n if n > 24 else n) for n in range(1, 74)])
    credit = [Decimal("37.56")] * 5 + [Decimal("37.58")]
    rows: list[dict[str, object]] = []
    for number in range(1, INSTALLMENTS + 1):
        due = _due(number)
        home = Decimal(0)
        if due.year < 2023:
            home = Decimal("215.00") if due.month == 9 else Decimal(0)
        else:
            home = Decimal(16 + number % 4)
        rows.append(
            {
                "number": number,
                "date": due,
                "capital": capital[number - 1],
                "interest": interest[number - 1],
                "life": Decimal(12 + number % 29),
                "home": home,
                "credit": credit[number - 68] if number >= 68 else Decimal(0),
                "fees": Decimal("3.80") if number <= 12 else Decimal(0),
                "stamp": _money(interest[number - 1] * Decimal("0.04")),
            }
        )
    return rows


def mortgage_workbook() -> bytes:
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)  # type: ignore[arg-type]

    summary = workbook.create_sheet("Resumo")
    summary.append(["Crédito habitação · resumo"])
    summary.append([])
    summary.append(["Preço do imóvel", 124000])
    summary.append(["Entrada", 12400])
    summary.append(["Empréstimo", 111600])
    summary.append(["Prestações pagas", 72])
    summary.append(["Capital amortizado", float(CAPITAL_TOTAL + PREPAYMENT)])
    summary.append(["Juros pagos", float(INTEREST_TOTAL)])
    summary.append([])
    summary.append(["Custos de aquisição"])
    for label, amount in COSTS:
        summary.append([label, float(Decimal(amount))])

    sheet = workbook.create_sheet("Sumário")
    sheet.append(["Crédito habitação · prestações"])
    sheet.append([])
    sheet.append(
        [
            "Nº",
            "Data",
            "Amortização",
            "Juros",
            "Seguro vida",
            "Seguro casa",
            "Seguro crédito",
            "Comissões",
            "Imposto de selo",
            "Total",
        ]
    )
    extra_pending = True
    for row in installments():
        parts = [row[k] for k in ("capital", "interest", "life", "home", "credit", "fees", "stamp")]
        if extra_pending and row["date"] >= PREPAYMENT_DATE:  # type: ignore[operator]
            # As in the real workbook: the capital of the prepayment month includes the extra.
            parts[0] = row["capital"] + PREPAYMENT  # type: ignore[operator]
            extra_pending = False
        total = sum((p for p in parts if isinstance(p, Decimal)), Decimal(0))
        sheet.append([row["number"], row["date"], *[float(p) for p in parts], float(total)])  # type: ignore[arg-type]

    prepayments = workbook.create_sheet("Amortização")
    prepayments.append(["Amortizações antecipadas"])
    prepayments.append(["Data", "Valor", "Comissão"])
    prepayments.append([PREPAYMENT_DATE, float(PREPAYMENT), None])

    years = workbook.create_sheet("Pago por anos")
    years.append(["Ano do contrato", "Pago"])
    years.append([1, 1234.56])

    works = workbook.create_sheet("Remodelações")
    works.append(["Obra", "Fornecedor", "Orçamento", "Entrada", "Estado", "Início", "Fim previsto"])
    for name, supplier, budget, deposit, start, end, _ in WORKS:
        works.append([name, supplier, float(budget), float(deposit) / 100, "Concluída", start, end])

    payments = workbook.create_sheet("Pagamentos")
    payments.append(["Obra", "Descrição", "Valor", "Data prevista", "Data de pagamento"])
    for name, _supplier, _budget, _deposit, _start, _end, phases in WORKS:
        for description, amount, planned, paid in phases:
            payments.append([name, description, float(amount), planned, paid])

    plan = workbook.create_sheet("Plano de pagamento")
    plan.append(["Euribor", "Amortização extra", "Anos para terminar"])
    plan.append([0.03, 0, 20])

    inflation = workbook.create_sheet("Inflação")
    inflation.append(["Ano", "IPC (%)"])
    for year, rate in INFLATION:
        inflation.append([int(year), float(rate)])

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "tests"
    / "fixtures"
    / "mortgage"
    / "mortgage-workbook.anonymized.xlsx"
)

EXPECTED = FIXTURE.with_name("mortgage-workbook.expected.json")


def expected_json() -> str:
    """What the parser makes of the fixture (the Node tests answer with it, as the parser would)."""
    from parser_service.config import Settings
    from parser_service.real_estate.workbook import MortgageWorkbookXlsx
    from parser_service.sniff import sniff

    file = sniff(FIXTURE.read_bytes(), Settings(secret="x" * 32))
    response = MortgageWorkbookXlsx().parse(file)
    return json.dumps(response.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_bytes(mortgage_workbook())
    EXPECTED.write_text(expected_json(), encoding="utf-8")
