"""A generated BPI Net "Extracto movimentos" workbook (fake holder, account, IBANs and merchants)
with the layout of the real export: title and holder rows, the table newest first with text dates,
an empty value date on most rows, and the download note. September 2026, closing balance 3 959,43.

`python -m tests.support.bpi` rewrites the shared fixture (`tests/fixtures/bpi/` at the repository
root): the xlsx the import end-to-end tests upload and the rows the parser must return."""

import json
from decimal import Decimal
from pathlib import Path

from .files import make_xlsx

HOLDER = "TITULAR EXEMPLO"
ACCOUNT = "1-0000000.000.001"
TRAINER_IBAN = "PT50003501350069602273023"
CLOSING = Decimal("3959.43")
# day, value day (empty = same day), description, amount
MOVEMENTS: list[tuple[str, str, str, str]] = [
    ("01-09-2026", "", "TRF CR SEPA+ 382 P/ DE89370400440532013000 XTB", "-300.00"),
    ("01-09-2026", "", "DD EDP COMERCIAL 88123/456", "-62.40"),
    ("02-09-2026", "31-08-2026", "31/08 COMPRA ELEC 1234567/01 SUPERMERCADO EXEMPLO", "-48.15"),
    ("03-09-2026", "", "TRF CR SEPA+ 1022 DE EMPRESA EXEMPLO LDA", "1850.00"),
    ("03-09-2026", "", "SEGURO ALLIANZ - APOLICE 123456789", "-34.90"),
    ("05-09-2026", "03-09-2026", "03/09 COMPRA ELEC 1234567/02 REPSOL LISBOA", "-52.30"),
    ("05-09-2026", "", f"TRF SEPA+ INST 386 DE {HOLDER}", "200.00"),
    ("05-09-2026", "", f"TRF SEPA+ INST 387 P/ {TRAINER_IBAN} PERSONAL TRAINER EXEMPLO", "-105.00"),
    ("07-09-2026", "", "DD VODAFONE PORTUGAL-COM. 55123", "-39.99"),
    ("07-09-2026", "", "DD AdAM Aguas 4411", "-27.80"),
    ("08-09-2026", "", "JUROS DE EMPRESTIMO", "-118.42"),
    ("08-09-2026", "", "AMORTIZACAO DE CAPITAL", "-241.58"),
    ("10-09-2026", "08-09-2026", "08/09 COMPRA ELEC 1234567/03 FARMACIA EXEMPLO", "-17.60"),
    ("10-09-2026", "", "10/09 LEV. ATM 000123 RUA EXEMPLO", "-40.00"),
    ("12-09-2026", "", "TRF CR INTRAB 77 DE FAMILIAR EXEMPLO", "100.00"),
    ("14-09-2026", "12-09-2026", "12/09 COMPRA ELEC 1234567/04 RESTAURANTE EXEMPLO", "-36.50"),
    ("14-09-2026", "12-09-2026", "12/09 PAG. PORTAGEM/TELEF. VIA VERDE", "-12.75"),
    ("15-09-2026", "", "DD BANCO INVEST 99001 PPR", "-150.00"),
    ("17-09-2026", "", "TRF SEPA+ INST 404 DE ANA EXEMPLO", "30.00"),
    ("21-09-2026", "19-09-2026", "19/09 COMPRA ELEC 1234567/05 SUPERMERCADO EXEMPLO", "-63.20"),
    ("24-09-2026", "", "PAGSERV 12345 67890", "-45.00"),
    ("28-09-2026", "26-09-2026", "26/09 COMPRA ELEC 1234567/06 CAFE EXEMPLO", "-8.40"),
    ("28-09-2026", "27-09-2026", "TRF SEPA+ INST 399 P/ PT50000700000011122233344 PEDRO", "-20.00"),
    ("30-09-2026", "", "IMPOSTO DE SELO", "-4.73"),
    ("30-09-2026", "", "MANUTENCAO DE CONTA", "-5.50"),
    ("30-09-2026", "", f"TRF SEPA+ INST 405 DE {HOLDER}", "25.00"),
]


def opening_balance() -> Decimal:
    return CLOSING - sum((Decimal(m[3]) for m in MOVEMENTS), Decimal(0))


def balances() -> list[Decimal]:
    """The running balance after each movement, oldest first."""
    out: list[Decimal] = []
    running = opening_balance()
    for *_rest, amount in MOVEMENTS:
        running += Decimal(amount)
        out.append(running)
    return out


def _pt(value: Decimal) -> str:
    return f"{value:,.2f}".replace(",", " ").replace(".", ",").replace(" ", ".")


def table_rows() -> list[list[object]]:
    """The table as the real export lists it: newest first, descriptions padded with spaces."""
    rows: list[list[object]] = []
    for (day, value_day, description, amount), balance in zip(MOVEMENTS, balances(), strict=True):
        rows.append([day, value_day, description.ljust(60), float(amount), float(balance)])
    return list(reversed(rows))


def workbook(
    movements: list[list[object]] | None = None, sheet: str = "Movimentos"
) -> dict[str, list[list[object]]]:
    rows = table_rows() if movements is None else movements
    return {
        sheet: [
            ["BPI Net"],
            [],
            ["EXTRACTO MOVIMENTOS"],
            [],
            ["Nome (Titular)", None, HOLDER],
            ["Conta e Moeda", None, f"{ACCOUNT} (EUR) - Banco BPI SA"],
            ["Data/Hora", None, "01-10-2026 09:30 Horas"],
            [],
            [],
            ["Saldo à Ordem Disponível:", None, f"{_pt(CLOSING - Decimal(80))} EUR"],
            ["Saldo à Ordem Contabilístico:", None, f"{_pt(CLOSING)} EUR"],
            [],
            ["Data Mov.", "Data Valor", "Descrição do Movimento", "Valor em EUR", "Saldo em EUR"],
            *rows,
            [],
            [
                "Nota: Este ficheiro apenas contempla os registos apresentados na página da "
                "internet, a partir da qual foi efectuado"
            ],
            ["o download do BPI Net."],
        ]
    }


def bpi_xlsx(**kwargs: object) -> bytes:
    return make_xlsx(workbook(**kwargs))  # type: ignore[arg-type]


def main() -> None:
    from parser_service.config import Settings
    from parser_service.parsers.bpi_xlsx import BpiXlsx
    from parser_service.sniff import sniff

    target = Path(__file__).resolve().parents[4] / "tests" / "fixtures" / "bpi"
    target.mkdir(parents=True, exist_ok=True)
    data = bpi_xlsx()
    (target / "bpi-movimentos.anonymized.xlsx").write_bytes(data)
    result = BpiXlsx().parse(sniff(data, Settings(secret="x" * 32)))
    (target / "bpi-movimentos.expected.json").write_text(
        json.dumps(result.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n"
    )


if __name__ == "__main__":
    main()
