"""A generated Trade Republic statement (no real data). Closing balance 5 285,98 €; interest in
the 12 months before the last movement 100,52 €; interest in total 197,38 €."""

from dataclasses import dataclass
from decimal import Decimal

from .files import make_layout_pdf

OPENING = Decimal("1000.00")
CLOSING = "5285.98"
INTEREST_LAST_12_MONTHS = "100.52"
INTEREST_TOTAL = "197.38"
MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


@dataclass(frozen=True)
class Move:
    year: int
    month: int
    day: int
    kind: str
    text: str
    amount: str  # signed


MOVES = [
    Move(2024, 2, 29, "Juros", "Juros de poupança", "48.43"),
    Move(2024, 3, 31, "Juros", "Juros de poupança", "48.43"),
    Move(2024, 11, 19, "Transferência", "Depósito aceite: Rui Exemplo para", "5000.00"),
    Move(2024, 11, 25, "Pagamento com cartão", "Supermercado Exemplo Lisboa", "-37.50"),
    Move(2024, 12, 2, "Negociação", "Compra ETF Exemplo World", "-500.00"),
    Move(2024, 12, 31, "Juros", "Juros de poupança", "20.10"),
    Move(2025, 3, 31, "Juros", "Juros de poupança", "25.15"),
    Move(2025, 5, 14, "Rendimento", "Dividendo ETF Exemplo World", "12.34"),
    Move(2025, 6, 30, "Juros", "Juros de poupança", "27.12"),
    Move(2025, 8, 9, "Pagamento com cartão", "Hotel Exemplo Porto", "-386.24"),
    Move(2025, 9, 30, "Juros", "Juros de poupança", "28.15"),
]

# Page 1 and page 2 print the columns at different positions, like the real statement.
LAYOUTS = [(14, 38, 76, 98, 118), (10, 34, 72, 94, 114)]  # type, desc, in, out, balance
PER_PAGE = 6


def euro(value: Decimal) -> str:
    whole, _, cents = f"{abs(value):.2f}".partition(".")
    grouped = f"{int(whole):,}".replace(",", " ")
    return f"{'-' if value < 0 else ''}{grouped},{cents} €"


def _at(parts: list[tuple[int, str]]) -> str:
    line = ""
    for col, text in parts:
        line = line.ljust(col) + text
    return line.rstrip()


def statement_lines(moves: list[Move] = MOVES) -> list[list[str]]:
    pages: list[list[str]] = []
    balance = OPENING
    for number, start in enumerate(range(0, len(moves), PER_PAGE)):
        c_type, c_desc, c_in, c_out, c_bal = LAYOUTS[number % len(LAYOUTS)]
        lines: list[str] = []
        if number == 0:
            lines += ["TRADE REPUBLIC BANK GMBH", "RESUMO", f"Conta corrente  {euro(OPENING)}", ""]
            lines.append("TRANSAÇÕES")
        lines.append(
            _at(
                [
                    (0, "DATA"),
                    (c_type, "TIPO"),
                    (c_desc, "DESCRIÇÃO"),
                    (c_in, "ENTRADA DE DINHEIRO"),
                    (c_out, "SAÍDA DE DINHEIRO"),
                    (c_bal, "SALDO"),
                ]
            )
        )
        for move in moves[start : start + PER_PAGE]:
            amount = Decimal(move.amount)
            balance += amount
            col = c_in if amount > 0 else c_out
            first, _, second = move.text.partition(" para")
            lines.append(_at([(0, f"{move.day} {MONTHS[move.month - 1]}."), (c_desc, first)]))
            lines.append(
                _at([(c_type, move.kind), (col, euro(abs(amount))), (c_bal, euro(balance))])
            )
            lines.append(_at([(0, str(move.year)), (c_desc, f"DE55502109007023130518{second}")]))
            lines.append("")
        pages.append(lines)
    pages[-1] += ["SÍNTESE DO BALANÇO", "Conta corrente"]
    return pages


def statement_pdf(moves: list[Move] = MOVES) -> bytes:
    return make_layout_pdf(statement_lines(moves))
