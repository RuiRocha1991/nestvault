import pytest
from fastapi.testclient import TestClient

from .conftest import AUTH, SECRET

GUARDED = [("get", "/parsers"), ("post", "/detect"), ("post", "/parse?parser_id=stub-csv")]


def test_health_needs_no_secret(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize(("method", "path"), GUARDED)
def test_missing_secret_is_401(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, content=b"a,b\n1,2\n")
    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"


@pytest.mark.parametrize(("method", "path"), GUARDED)
@pytest.mark.parametrize("secret", ["wrong", "", SECRET + "x", SECRET[:-1], "é" * 40])
def test_wrong_secret_is_401(client: TestClient, method: str, path: str, secret: str) -> None:
    headers = {"X-Parser-Secret": secret.encode()} if secret else {}
    response = client.request(method, path, content=b"a,b\n1,2\n", headers=headers)
    assert response.status_code == 401


def test_the_right_secret_is_accepted(client: TestClient) -> None:
    assert client.get("/parsers", headers=AUTH).status_code == 200


def test_secret_shorter_than_32_characters_cannot_start_the_service() -> None:
    from parser_service.config import Settings

    with pytest.raises(ValueError, match="at least"):
        Settings(secret="short")


def test_docs_endpoints_are_not_served(client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path, headers=AUTH).status_code == 404
