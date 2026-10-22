from collections.abc import Iterable

from .errors import UnknownParserError
from .models import DetectResult, ParserInfo
from .parsers.banco_invest import BancoInvestXlsx
from .parsers.base import Parser
from .sniff import SniffedFile

# Below this score the file is treated as unrecognised and the user is asked to choose.
DETECT_THRESHOLD = 0.5


class Registry:
    def __init__(self, parsers: Iterable[Parser] = ()) -> None:
        self._parsers: dict[str, Parser] = {}
        for parser in parsers:
            if parser.id in self._parsers:
                raise ValueError(f"Duplicate parser id: {parser.id}")
            self._parsers[parser.id] = parser

    def all(self) -> list[Parser]:
        return sorted(self._parsers.values(), key=lambda parser: parser.id)

    def info(self) -> list[ParserInfo]:
        return [ParserInfo(id=p.id, kind=p.kind, version=p.version) for p in self.all()]

    def get(self, parser_id: str) -> Parser:
        try:
            return self._parsers[parser_id]
        except KeyError:
            raise UnknownParserError from None

    def detect(self, file: SniffedFile) -> list[DetectResult]:
        """Every parser that scores above the threshold, best first (ties by id)."""
        results: list[DetectResult] = []
        for parser in self.all():
            confidence = min(1.0, max(0.0, parser.detect(file)))
            if confidence >= DETECT_THRESHOLD:
                results.append(
                    DetectResult(
                        parser_id=parser.id,
                        kind=parser.kind,
                        version=parser.version,
                        confidence=round(confidence, 4),
                    )
                )
        return sorted(results, key=lambda r: (-r.confidence, r.parser_id))


def default_registry() -> Registry:
    """The parsers shipped with the service. Each parser task (NES-57 ...) adds its own here."""
    return Registry([BancoInvestXlsx()])
