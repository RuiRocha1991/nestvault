"""Investment-transactions CSV in the prototype format. Port of `opiParse` in the v28 prototype.

Columns (any order, accents and case ignored, Portuguese or English headers):
`Data;Tipo;Ticker;Nome;Tipo de ativo;Moeda;Quantidade;Preço;Comissão;Valor;Imposto;Subconta;
Titular;Cotação atual;Data cotação`. Separator `;` (or `,`, tab, `|`), decimal comma, UTF-8 or
Windows-1252. One row per operation: `buy`, `sell` or `dividend`.

Amounts are the cash flow of the operation (buys negative, sells and dividends positive). The
sub-account is only reported by name: linking it to the account's sub-accounts (`opiFindSub`) needs
the account, so the import does it. Every cell is read as text and never evaluated, so a cell such
as `=HYPERLINK(...)` stays a literal string; `export_csv` prefixes such cells with `'`.
"""

import csv
import hashlib
import io
from collections import Counter
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

from ..errors import ParseFailedError, UnsupportedFileError
from ..helpers import normalize_text, parse_date, parse_num
from ..models import BrokerRow, ParseMeta, ParseResponse, ParserKind, PriceEntry
from ..sniff import SniffedFile

# Same aliases as the prototype's `OPI_COLS`, plus English headers.
COLUMNS: dict[str, tuple[str, ...]] = {
    "date": ("DATA", "DATE"),
    "type": ("TIPO", "OPERACAO", "TYPE", "OPERATION"),
    "ticker": ("TICKER", "CODIGO", "ISIN", "SIMBOLO", "SYMBOL"),
    "name": ("NOME", "ATIVO", "FUNDO", "NAME", "ASSET"),
    "asset_type": ("TIPO DE ATIVO", "CLASSE", "ASSET TYPE", "ASSET CLASS"),
    "currency": ("MOEDA", "CURRENCY"),
    "quantity": ("QUANTIDADE", "QTD", "UNIDADES", "QUANTITY", "UNITS"),
    "price": ("PRECO", "VALOR UNITARIO", "COTACAO NA DATA", "VALOR SUBSCRICAO", "PRICE"),
    "fee": ("COMISSAO", "COMISSOES", "FEE", "FEES", "COMMISSION"),
    "amount": ("VALOR", "MONTANTE", "AMOUNT"),
    "tax": ("IMPOSTO", "TAX"),
    "subaccount": ("SUBCONTA", "SUBSCRICAO", "SUB-ACCOUNT", "SUBACCOUNT", "SUB ACCOUNT"),
    "holder": ("TITULAR", "HOLDER", "OWNER"),
    "last_price": ("COTACAO ATUAL", "COTACAO", "CURRENT PRICE", "LAST PRICE"),
    "last_date": ("DATA COTACAO", "QUOTE DATE", "PRICE DATE"),
}
TEXT_FIELDS = ("ticker", "name", "asset_type", "subaccount", "holder")
TYPES = {
    "COMPRA": "buy",
    "SUBSCRICAO": "buy",
    "SUBS / T": "buy",
    "BUY": "buy",
    "VENDA": "sell",
    "RESGATE": "sell",
    "SELL": "sell",
    "DIVIDENDO": "dividend",
    "DISTRIBUICAO": "dividend",
    "DIVIDEND": "dividend",
}
TYPE_LABELS = {"buy": "Compra", "sell": "Venda", "dividend": "Dividendo"}
HEADER_SCAN_ROWS = 15
FORMULA_PREFIXES = ("=", "+", "-", "@")
TEXT_MAX = 500
TEMPLATE_HEADER = [
    "Data", "Tipo", "Ticker", "Nome", "Tipo de ativo", "Moeda", "Quantidade", "Preço",
    "Comissão", "Valor", "Imposto", "Subconta", "Titular", "Cotação atual", "Data cotação",
]  # fmt: skip


class InvestmentCsv:
    id = "investment-csv"
    kind: ParserKind = "broker"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "csv" or file.text is None:
            return 0.0
        found = _find_header(_read(file.text, limit=HEADER_SCAN_ROWS))
        if found is None:
            return 0.0
        _, column = found
        if not column.keys() & {"ticker", "name"}:
            return 0.0
        if "price" not in column:
            return 0.6
        return 0.95 if column.keys() & {"subaccount", "holder", "type"} else 0.85

    def parse(self, file: SniffedFile) -> ParseResponse:
        if file.magic != "csv" or file.text is None:
            raise UnsupportedFileError("This parser reads CSV files only.")
        table = _read(file.text)
        found = _find_header(table)
        if found is None:
            raise ParseFailedError(
                "The header was not found (Data, Tipo, Ticker, Quantidade and Preço are needed)."
            )
        header_at, column = found
        if not column.keys() & {"ticker", "name"}:
            raise ParseFailedError("The Ticker column is missing.")

        rows: list[BrokerRow] = []
        prices: dict[str, PriceEntry] = {}
        seen: Counter[str] = Counter()
        ignored = unknown_types = formulas = 0
        for raw in table[header_at + 1 :]:
            if not any(cell.strip() for cell in raw):
                continue
            cell = _Cells(raw, column)
            formulas += sum(1 for f in TEXT_FIELDS if cell(f).startswith(FORMULA_PREFIXES))
            day = parse_date(cell("date"))
            symbol = (cell("ticker") or cell("name")).upper()[:TEXT_MAX]
            if day is None or not symbol:
                ignored += 1
                continue
            type_text = normalize_text(cell("type"))
            kind = TYPES.get(type_text, "buy" if not type_text else None)
            if kind is None:
                unknown_types += 1
                continue
            currency = (cell("currency") or "EUR").upper()
            if len(currency) != 3 or not (currency.isalpha() and currency.isascii()):
                ignored += 1
                continue
            quantity = _abs(cell("quantity")) or Decimal(0)
            price = _num(cell("price"))
            fee = abs(_num(cell("fee")) or Decimal(0))
            tax = abs(_num(cell("tax")) or Decimal(0))
            if kind == "dividend":
                amount_cell = _abs(cell("amount"))
                amount = amount_cell
                if amount is None and quantity and price is not None:
                    amount = quantity * price
                if amount is None:
                    ignored += 1
                    continue
                quantity_out = price_out = None
            else:
                if not quantity or price is None:
                    ignored += 1
                    continue
                gross = quantity * price
                amount = -(gross + fee) if kind == "buy" else gross - fee
                quantity_out, price_out = quantity, price
            subaccount = cell("subaccount") or None
            holder = cell("holder") or None
            # Like the prototype's hash, plus a counter so identical lines in one file stay apart.
            key = "|".join(
                [subaccount or holder or "", day, symbol, kind, _plain(quantity),
                 _plain(price or Decimal(0)), _plain(amount)]
            )  # fmt: skip
            seen[key] += 1
            digest = hashlib.sha256(key.encode()).hexdigest()[:16]
            rows.append(
                BrokerRow(
                    kind="broker",
                    date=day,
                    type=kind,
                    symbol=symbol,
                    name=cell("name")[:TEXT_MAX] or None,
                    quantity=None if quantity_out is None else _plain(quantity_out),
                    price=None if price_out is None else _plain(price_out),
                    amount=_plain(amount),
                    currency=currency,
                    holder=holder and holder[:TEXT_MAX],
                    external_id=f"csv:{digest}#{seen[key]}",
                    subaccount=subaccount and subaccount[:TEXT_MAX],
                    asset_type=cell("asset_type")[:TEXT_MAX] or None,
                    fee=_plain(fee) if fee else None,
                    tax=_plain(tax) if tax else None,
                )
            )
            last = _num(cell("last_price"))
            if last is not None and last > 0:
                quoted = parse_date(cell("last_date")) or day
                known = prices.get(symbol)
                if known is None or quoted >= known.date:
                    prices[symbol] = PriceEntry(
                        symbol=symbol, date=quoted, price=_plain(last), currency=currency
                    )
        if not rows:
            raise ParseFailedError("No valid transactions were found in this file.")
        names = sorted({r.subaccount or r.holder or "" for r in rows} - {""}, key=str.lower)
        return ParseResponse(
            rows=list(rows),
            meta=ParseMeta(
                parser_id=self.id,
                parser_version=self.version,
                row_count=len(rows),
                subaccounts=names,
            ),
            warnings=_warnings(ignored, unknown_types, formulas),
            prices=list(prices.values()),
        )


def template_csv() -> str:
    """The downloadable template: header plus two example rows (fictitious data)."""
    return export_csv(
        [
            BrokerRow(
                kind="broker", date="2026-01-15", type="buy", symbol="ABCD",
                name="Example Global Fund", quantity="10", price="25.5", amount="-257.5",
                currency="EUR", subaccount="Sub-account A", holder="Alex Example",
                asset_type="Fundo", fee="2.5",
            ),
            BrokerRow(
                kind="broker", date="2026-03-20", type="dividend", symbol="ABCD",
                name="Example Global Fund", amount="3.2", currency="EUR",
                subaccount="Sub-account A", tax="0.8",
            ),
        ],
        [PriceEntry(symbol="ABCD", date="2026-04-01", price="26.1", currency="EUR")],
    )  # fmt: skip


def export_csv(rows: Sequence[BrokerRow], prices: Sequence[PriceEntry] = ()) -> str:
    """Rows -> this CSV format, so `parse(export_csv(x))` gives `x` back. A text cell that a
    spreadsheet would read as a formula (`=`, `+`, `-`, `@`) gets a leading `'`."""
    quotes = {p.symbol: p for p in prices}
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";", lineterminator="\n")
    writer.writerow(TEMPLATE_HEADER)
    for row in rows:
        last = quotes.pop(row.symbol or "", None)
        text = [row.symbol, row.name, row.asset_type, row.currency, row.subaccount, row.holder]
        symbol, name, asset_type, currency, subaccount, holder = (_safe(c) for c in text)
        writer.writerow(
            [
                row.date, TYPE_LABELS[row.type], symbol, name, asset_type, currency,
                _comma(row.quantity), _comma(row.price), _comma(row.fee),
                _comma(row.amount) if row.type == "dividend" else "", _comma(row.tax),
                subaccount, holder, _comma(last.price) if last else "", last.date if last else "",
            ]
        )  # fmt: skip
    return out.getvalue()


def _safe(value: str | None) -> str:
    text = value or ""
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def _comma(value: str | None) -> str:
    return "" if value is None else value.replace(".", ",")


def _warnings(ignored: int, unknown_types: int, formulas: int) -> list[str]:
    out: list[str] = []
    if ignored:
        out.append(f"{ignored} rows without a valid date, ticker, quantity or price were ignored.")
    if unknown_types:
        out.append(f"{unknown_types} rows with an unknown type were ignored.")
    if formulas:
        out.append(f"{formulas} text cells start with a formula character and are kept as text.")
    return out


class _Cells:
    def __init__(self, raw: list[str], column: dict[str, int]) -> None:
        self._raw, self._column = raw, column

    def __call__(self, name: str) -> str:
        index = self._column.get(name)
        return self._raw[index].strip() if index is not None and index < len(self._raw) else ""


def _read(text: str, limit: int | None = None) -> list[list[str]]:
    """Delimiter chosen like the prototype's `parseCSV`: the most frequent in the first 40 lines."""
    lines = text.replace("\r", "").split("\n")[:40]
    delimiter = max(";,\t|", key=lambda d: (sum(line.count(d) for line in lines), d == ";"))
    out: list[list[str]] = []
    try:
        for row in csv.reader(io.StringIO(text), delimiter=delimiter):
            out.append([c.strip() for c in row])
            if limit is not None and len(out) >= limit:
                break
    except csv.Error as exc:
        raise ParseFailedError("The CSV file is malformed.") from exc
    return out


def _find_header(table: list[list[str]]) -> tuple[int, dict[str, int]] | None:
    for index, row in enumerate(table[:HEADER_SCAN_ROWS]):
        names = [normalize_text(cell) for cell in row]
        column: dict[str, int] = {}
        for field, aliases in COLUMNS.items():
            found = next((a for a in aliases if a in names), None)
            if found is not None:
                column[field] = names.index(found)
        if "date" in column and "quantity" in column:
            return index, column
    return None


def _num(value: str) -> Decimal | None:
    parsed: Any = parse_num(value)
    return None if parsed is None else Decimal(parsed)


def _abs(value: str) -> Decimal | None:
    number = _num(value)
    return None if number is None else abs(number)


def _plain(value: Decimal) -> str:
    return format(value.normalize(), "f") if value != 0 else "0"
