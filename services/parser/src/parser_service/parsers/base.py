"""The interface every parser implements, code parser or spec parser alike."""

from typing import Protocol, runtime_checkable

from ..models import ParseResponse, ParserKind
from ..sniff import SniffedFile


@runtime_checkable
class Parser(Protocol):
    id: str
    kind: ParserKind
    version: str

    def detect(self, file: SniffedFile) -> float:
        """Confidence 0..1 from the fingerprint (type, sheets, headers, key phrases)."""
        ...

    def parse(self, file: SniffedFile) -> ParseResponse:
        """Rows, meta and warnings. Raises `ParseFailedError` when the file does not fit."""
        ...
