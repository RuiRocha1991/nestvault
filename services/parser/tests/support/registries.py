"""Stand-in parsers used until the real ones land (NES-57 ...). They exercise the machinery."""

from parser_service.errors import ParseFailedError
from parser_service.models import BankRow, BrokerRow, ParseMeta, ParseResponse, ParserKind
from parser_service.registry import Registry
from parser_service.sniff import SniffedFile


class StubBank:
    id = "stub-bank-xlsx"
    kind: ParserKind = "bank"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "xlsx" or "StubBank" not in file.sheet_names:
            return 0.0
        header = [str(cell) for cell in file.header_rows["StubBank"][0]]
        return 0.95 if header[:3] == ["Date", "Description", "Amount"] else 0.55

    def parse(self, file: SniffedFile) -> ParseResponse:
        rows = file.header_rows.get("StubBank", [])[1:]
        parsed = [
            BankRow(kind="bank", date=str(r[0]), description=str(r[1]), amount=str(r[2]))
            for r in rows
            if r and r[0]
        ]
        return ParseResponse(
            rows=list(parsed),
            meta=ParseMeta(parser_id=self.id, parser_version=self.version, row_count=len(parsed)),
            warnings=[],
        )


class StubBroker:
    id = "stub-broker-pdf"
    kind: ParserKind = "broker"
    version = "2.1.0"

    def detect(self, file: SniffedFile) -> float:
        if file.magic != "pdf":
            return 0.0
        return 0.9 if any("STUB BROKER" in line for line in file.pdf_lines) else 0.1

    def parse(self, file: SniffedFile) -> ParseResponse:
        row = BrokerRow(
            kind="broker",
            date="2026-01-05",
            type="dividend",
            symbol="AAA",
            amount="1.50",
            currency="USD",
        )
        return ParseResponse(
            rows=[row],
            meta=ParseMeta(parser_id=self.id, parser_version=self.version, row_count=1),
            warnings=["stub"],
        )


class StubCsv:
    id = "stub-csv"
    kind: ParserKind = "bank"
    version = "0.1.0"

    def detect(self, file: SniffedFile) -> float:
        return 0.6 if file.magic == "csv" else 0.0

    def parse(self, file: SniffedFile) -> ParseResponse:
        raise ParseFailedError("This stub never parses.")


class Malformed:
    """Emits a row that breaks the schema; the service must refuse to forward it."""

    id = "stub-malformed"
    kind: ParserKind = "bank"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        return 0.0

    def parse(self, file: SniffedFile) -> ParseResponse:
        row = BankRow.model_construct(kind="bank", date="05/01/2026", description="x", amount="1")
        return ParseResponse.model_construct(
            rows=[row],
            meta=ParseMeta(parser_id=self.id, parser_version=self.version, row_count=1),
            warnings=[],
        )


class Exploding:
    id = "stub-exploding"
    kind: ParserKind = "bank"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        return 0.0

    def parse(self, file: SniffedFile) -> ParseResponse:
        raise RuntimeError("IBAN PT50000000000000000000000 must never reach the client")


class Sleeper:
    id = "stub-sleeper"
    kind: ParserKind = "bank"
    version = "1.0.0"

    def detect(self, file: SniffedFile) -> float:
        return 0.0

    def parse(self, file: SniffedFile) -> ParseResponse:
        while True:
            pass


def stub_registry() -> Registry:
    return Registry([StubBank(), StubBroker(), StubCsv(), Malformed(), Exploding(), Sleeper()])
