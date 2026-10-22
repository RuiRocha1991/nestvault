import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from parser_service.config import Settings
from parser_service.errors import ParserError
from parser_service.limits import compile_pattern, safe_search

from .conftest import AUTH, SECRET
from .support.files import make_many_entries, make_xlsx, make_zip_bomb


def test_11_mb_file_is_rejected_quickly(client: TestClient) -> None:
    started = time.monotonic()
    response = client.post("/detect", content=b"x" * 11_000_000, headers=AUTH)
    assert response.status_code == 413
    assert response.json()["code"] == "file_too_large"
    assert "10 MB" in response.json()["message"]
    assert time.monotonic() - started < 2


def test_chunked_body_over_the_limit_is_rejected(client: TestClient) -> None:
    def body() -> Iterator[bytes]:  # no Content-Length: the stream itself must be capped
        for _ in range(11):
            yield b"x" * 1_000_000

    response = client.post("/detect", content=body(), headers=AUTH)
    assert response.status_code == 413


def test_file_at_the_limit_is_read(client: TestClient) -> None:
    response = client.post("/detect", content=b"a,b\n" + b"1,2\n" * 2_000, headers=AUTH)
    assert response.status_code == 200


def test_zip_bomb_is_rejected_quickly(client: TestClient) -> None:
    bomb = make_zip_bomb(150)
    assert len(bomb) < 1_000_000
    started = time.monotonic()
    response = client.post("/detect", content=bomb, headers=AUTH)
    assert response.status_code == 422
    assert response.json()["code"] == "unsafe_archive"
    assert time.monotonic() - started < 5  # includes starting the worker process


def test_archive_with_too_many_entries_is_rejected(client: TestClient) -> None:
    response = client.post("/detect", content=make_many_entries(2_500), headers=AUTH)
    assert response.status_code == 422
    assert response.json()["code"] == "unsafe_archive"


def test_corrupt_zip_is_rejected(client: TestClient) -> None:
    response = client.post("/detect", content=b"PK\x03\x04" + b"\x00" * 200, headers=AUTH)
    assert response.status_code == 422


def test_zip_that_is_not_a_workbook_is_unsupported(client: TestClient) -> None:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("notes.txt", "hello")
    response = client.post("/detect", content=buffer.getvalue(), headers=AUTH)
    assert response.status_code == 415


def test_binary_and_empty_files_are_unsupported(client: TestClient) -> None:
    assert client.post("/detect", content=b"\x00\x01\x02" * 100, headers=AUTH).status_code == 415
    assert client.post("/detect", content=b"", headers=AUTH).status_code == 415


def test_a_job_that_never_ends_is_killed_at_the_timeout() -> None:
    from fastapi.testclient import TestClient as Client

    from parser_service.app import create_app

    from .support.registries import stub_registry

    settings = Settings(secret=SECRET, job_timeout_seconds=1.5)
    started = time.monotonic()
    with Client(create_app(settings, stub_registry)) as client:
        response = client.post("/parse?parser_id=stub-sleeper", content=b"a,b\n1,2\n", headers=AUTH)
    assert response.status_code == 504
    assert response.json()["code"] == "timeout"
    assert time.monotonic() - started < 8


def test_catastrophic_regex_times_out() -> None:
    settings = Settings(secret=SECRET, regex_timeout_seconds=0.2)
    pattern = compile_pattern(r"^(a|aa)+$", settings)
    started = time.monotonic()
    with pytest.raises(ParserError) as raised:
        safe_search(pattern, "a" * 40 + "!", settings)
    assert raised.value.code == "pattern_timeout"
    assert time.monotonic() - started < 2


def test_oversized_and_invalid_patterns_are_refused() -> None:
    settings = Settings(secret=SECRET)
    with pytest.raises(ParserError, match="too long"):
        compile_pattern("a" * 501, settings)
    with pytest.raises(ParserError, match="not valid"):
        compile_pattern("(", settings)


def test_real_workbook_passes_the_archive_guards(client: TestClient) -> None:
    content = make_xlsx({"Sheet": [["a", "b"], [1, 2]]})
    assert client.post("/detect", content=content, headers=AUTH).status_code == 200
