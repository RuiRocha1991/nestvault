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
    Move(2024, 2, 29, "Juros", "Your interest payment", "48.43"),
    Move(2024, 3, 31, "Juros", "Your interest payment", "48.43"),
    Move(2024, 11, 19, "Transferência", "Depósito aceite: Rui Exemplo para", "5000.00"),
    Move(2024, 11, 25, "Transação com cartão", "SUPERMERCADO EXEMPLO LDA", "-37.50"),
    Move(2024, 12, 2, "Negociação", "Compra ETF Exemplo World", "-500.00"),
    Move(2024, 12, 31, "Juros", "Your interest payment", "20.10"),
    Move(2025, 3, 31, "Juros", "Your interest payment", "25.15"),
    Move(2025, 5, 14, "Rendimento", "Dividendo ETF Exemplo World", "12.34"),
    Move(2025, 6, 30, "Juros", "Your interest payment", "27.12"),
    Move(2025, 8, 9, "Transação com cartão", "HOTEL EXEMPLO PORTO", "-386.24"),
    Move(2025, 9, 30, "Juros", "Your interest payment", "28.15"),
]

# Page 1 and page 2 print the columns at slightly different positions, like the real statement.
LAYOUTS = [(16, 24, 54, 80, 111), (16, 24, 50, 76, 106)]  # type, desc, in, out, balance
MARGIN = 10
PER_PAGE = 6
FOOTER = [
    "Trade Republic Bank GmbH, Sucursal em Portugal www.traderepublic.pt",
    "Av. da República 50 VAT ID No. DE000000000",
    "1050-196 Lisboa                AG Charlottenburg, HRB 000000 B",
    "Gerado no dia 2026-10-10 15:39:16 Europe/Lisbon (UTC+01:00) Página 1 de 2",
]


def euro(value: Decimal) -> str:
    whole, _, cents = f"{abs(value):.2f}".partition(".")
    grouped = f"{int(whole):,}".replace(",", " ")
    return f"{'-' if value < 0 else ''}{grouped},{cents} €"


def _at(parts: list[tuple[int, str]]) -> str:
    line = ""
    for col, text in parts:
        line = line.ljust(col) + text
    return line.rstrip()


def _movement_lines(move: Move, balance: Decimal, columns: tuple[int, ...]) -> list[str]:
    c_type, c_desc, c_in, c_out, c_bal = columns
    amount = Decimal(move.amount)
    money_col = c_in if amount > 0 else c_out
    date = f"{move.day:02d} {MONTHS[move.month - 1]}."
    year = str(move.year)
    values = [(money_col, euro(abs(amount))), (c_bal, euro(balance))]
    if move.kind == "Juros":
        return [
            _at([(MARGIN, date)]),
            _at([(c_type, "Juros"), (c_type + 8, move.text), *values]),
            _at([(MARGIN, year)]),
        ]
    if move.kind == "Transação com cartão":  # the type wraps over the date and the year line
        return [
            _at([(MARGIN, date), (MARGIN + 8, "Transação com")]),
            _at([(c_desc, move.text), *values]),
            _at([(MARGIN, year), (c_type, "cartão")]),
        ]
    if move.kind == "Comissão":  # type and description are a single space apart
        return [
            _at([(MARGIN, date)]),
            _at([(c_type - 1, f"Comissão {move.text}"), *values]),
            _at([(MARGIN, year)]),
        ]
    return [
        _at([(MARGIN, date), (c_desc, move.text)]),
        _at([(c_type, move.kind), *values]),
        _at([(MARGIN, year), (c_desc, "DE00000000000000000000")]),
    ]


def statement_lines(moves: list[Move] = MOVES, footer_gap: int = 0) -> list[list[str]]:
    pages: list[list[str]] = []
    balance = OPENING
    for number, start in enumerate(range(0, len(moves), PER_PAGE)):
        columns = LAYOUTS[number % len(LAYOUTS)]
        c_type, c_desc, c_in, c_out, c_bal = columns
        lines = [" " * MARGIN + "TRADE REPUBLIC BANK GMBH, SUCURSAL EM PORTUGAL", ""]
        if number == 0:
            lines += [
                "RESUMO DO EXTRATO DE CONTA",
                f"Conta corrente  {euro(OPENING)}",
                "",
                "TRANSAÇÕES",
            ]
        lines.append(
            _at(
                [
                    (MARGIN, "DATA"),
                    (c_type, "TIPO"),
                    (c_desc, "DESCRIÇÃO"),
                    (c_in, "ENTRADA DE DINHEIRO"),
                    (c_out, "SAÍDA DE DINHEIRO"),
                    (c_bal, "SALDO"),
                ]
            )
        )
        for move in moves[start : start + PER_PAGE]:
            balance += Decimal(move.amount)
            lines += _movement_lines(move, balance, columns)
            if footer_gap:  # pdftotext separates movements with a blank line, pdfplumber does not
                lines.append("")
        # pdfplumber puts the footer right after the last year line (no blank line); pdftotext
        # leaves a gap. `footer_gap` > 0 imitates pdftotext (gaps between movements and footer).
        pages.append([*lines, *[""] * footer_gap, *(" " * MARGIN + text for text in FOOTER)])
    pages[-1] += ["", "SÍNTESE DO BALANÇO", "Conta corrente"]
    return pages


def statement_pdf(moves: list[Move] = MOVES, footer_gap: int = 0) -> bytes:
    return make_layout_pdf(statement_lines(moves, footer_gap))
