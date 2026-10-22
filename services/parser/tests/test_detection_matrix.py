"""Detection matrix scaffold: every parser x every fixture.

Each fixture declares which parser ids must detect it. The test asserts the exact set, so adding a
parser (or a fixture) that overlaps another one's fingerprint fails here. NES-57 ... add their real
parsers to `default_registry()` and their fixtures to `FIXTURES`; the stubs only prove the scaffold.
"""

from collections.abc import Callable
from dataclasses import dataclass

import pytest

from parser_service.config import Settings
from parser_service.registry import Registry, default_registry
from parser_service.sniff import sniff

from .conftest import SECRET
from .support.files import make_csv, make_pdf, make_xlsx
from .support.registries import stub_registry


@dataclass(frozen=True)
class Fixture:
    name: str
    build: Callable[[], bytes]
    detected_by: frozenset[str]


FIXTURES = [
    Fixture(
        "stub-bank.xlsx",
        lambda: make_xlsx(
            {"StubBank": [["Date", "Description", "Amount"], ["2026-01-05", "x", "1"]]}
        ),
        frozenset({"stub-bank-xlsx"}),
    ),
    Fixture("stub-broker.pdf", lambda: make_pdf(["STUB BROKER"]), frozenset({"stub-broker-pdf"})),
    Fixture("plain.csv", lambda: make_csv("a;b;c", "1;2;3"), frozenset({"stub-csv"})),
    Fixture("unknown.pdf", lambda: make_pdf(["nothing to see"]), frozenset()),
    Fixture("unknown.xlsx", lambda: make_xlsx({"Other": [["x"]]}), frozenset()),
]
SETTINGS = Settings(secret=SECRET)


def _matrix(registry: Registry) -> list[tuple[str, str, Fixture]]:
    return [(p.id, f.name, f) for p in registry.all() for f in FIXTURES]


@pytest.mark.parametrize(("parser_id", "name", "fixture"), _matrix(stub_registry()))
def test_every_parser_against_every_fixture(parser_id: str, name: str, fixture: Fixture) -> None:
    parser = stub_registry().get(parser_id)
    detected = parser.detect(sniff(fixture.build(), SETTINGS)) >= 0.5
    assert detected == (parser_id in fixture.detected_by), f"{parser_id} vs {name}"


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda f: f.name)
def test_ranking_is_deterministic_and_matches_the_expected_set(fixture: Fixture) -> None:
    results = stub_registry().detect(sniff(fixture.build(), SETTINGS))
    assert {r.parser_id for r in results} == fixture.detected_by
    assert results == sorted(results, key=lambda r: (-r.confidence, r.parser_id))


def test_shipped_registry_ids_are_unique_and_versioned() -> None:
    ids = [p.id for p in default_registry().all()]
    assert len(ids) == len(set(ids))
    assert all(p.version for p in default_registry().all())


def test_duplicate_parser_ids_are_refused() -> None:
    parser = stub_registry().get("stub-csv")
    with pytest.raises(ValueError, match="Duplicate"):
        Registry([parser, parser])
