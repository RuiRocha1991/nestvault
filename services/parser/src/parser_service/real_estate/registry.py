"""The real estate parsers and how a file is matched to one (same threshold as the statements)."""

from collections.abc import Iterable
from typing import Protocol

from ..errors import UnknownParserError
from ..registry import DETECT_THRESHOLD
from ..sniff import SniffedFile
from .csv_templates import LoanInstallmentsCsv, WorksPaymentsCsv
from .models import RealEstateDetectResult, RealEstateParseResponse
from .workbook import MortgageWorkbookXlsx


class RealEstateParser(Protocol):
    id: str
    version: str

    def detect(self, file: SniffedFile) -> float: ...

    def parse(self, file: SniffedFile) -> RealEstateParseResponse: ...


class RealEstateRegistry:
    def __init__(self, parsers: Iterable[RealEstateParser] = ()) -> None:
        self._parsers: dict[str, RealEstateParser] = {}
        for parser in parsers:
            if parser.id in self._parsers:
                raise ValueError(f"Duplicate parser id: {parser.id}")
            self._parsers[parser.id] = parser

    def all(self) -> list[RealEstateParser]:
        return sorted(self._parsers.values(), key=lambda parser: parser.id)

    def get(self, parser_id: str) -> RealEstateParser:
        try:
            return self._parsers[parser_id]
        except KeyError:
            raise UnknownParserError from None

    def detect(self, file: SniffedFile) -> list[RealEstateDetectResult]:
        """Every parser above the threshold, best first (ties by id)."""
        results = []
        for parser in self.all():
            confidence = min(1.0, max(0.0, parser.detect(file)))
            if confidence >= DETECT_THRESHOLD:
                results.append(
                    RealEstateDetectResult(
                        parser_id=parser.id, version=parser.version, confidence=round(confidence, 4)
                    )
                )
        return sorted(results, key=lambda r: (-r.confidence, r.parser_id))


def default_real_estate_registry() -> RealEstateRegistry:
    return RealEstateRegistry([MortgageWorkbookXlsx(), LoanInstallmentsCsv(), WorksPaymentsCsv()])
