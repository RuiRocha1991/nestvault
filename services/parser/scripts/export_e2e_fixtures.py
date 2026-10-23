"""Writes the generated statements the Playwright import tests upload.

Run from services/parser: `uv run python scripts/export_e2e_fixtures.py [folder]`; the default
folder is tests/e2e/fixtures/imports at the repository root. Everything is generated from the
builders the parser tests use: no real statement is stored.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.support.banco_invest import banco_invest_xlsx
from tests.support.bpi import bpi_xlsx
from tests.support.files import make_csv
from tests.support.trade_republic import statement_pdf
from tests.support.xtb import xtb_xlsx

TEMPLATE = Path(__file__).resolve().parent.parent / "templates" / "investment-transactions.csv"
DEFAULT_OUT = Path(__file__).resolve().parents[3] / "tests" / "e2e" / "fixtures" / "imports"


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "trade-republic.pdf").write_bytes(statement_pdf())
    (out / "xtb.xlsx").write_bytes(xtb_xlsx())
    (out / "banco-invest.xlsx").write_bytes(banco_invest_xlsx())
    (out / "bpi.xlsx").write_bytes(bpi_xlsx())
    (out / "investment-transactions.csv").write_bytes(TEMPLATE.read_bytes())
    (out / "generic-bank.csv").write_bytes(
        make_csv(
            "Data;Descrição;Valor;Saldo",
            "05-03-2026;Café Central;-1,20;998,80",
            "06-03-2026;Supermercado Alfa;-34,50;964,30",
            "07-03-2026;Salário março;1500,00;2464,30",
        )
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT)
