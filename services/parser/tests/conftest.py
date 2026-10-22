from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from parser_service.app import create_app
from parser_service.config import Settings

from .support.registries import stub_registry

SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz"
AUTH = {"X-Parser-Secret": SECRET}


@pytest.fixture
def settings() -> Settings:
    return Settings(secret=SECRET, job_timeout_seconds=3.0)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings, stub_registry)) as test_client:
        yield test_client
