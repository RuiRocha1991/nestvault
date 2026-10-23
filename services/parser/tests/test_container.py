"""Isolation checks on the real image (security control 21). Marked `docker`: they need a Docker
daemon, so the default `pytest` skips them; CI and `pytest -m docker` run them.

The container is started with the same hardening as docker-compose.yml, and a second test reads
the compose file itself so the two cannot drift apart.
"""

import json
import os
import subprocess
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

from .conftest import SECRET

pytestmark = pytest.mark.docker

SERVICE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_DIR.parent.parent
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
IMAGE = "nestvault-parser:test"
TMPFS = "/tmp:size=64m,uid=10001,gid=10001"  # noqa: S108


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        ["docker", *args],  # noqa: S607
        capture_output=True,
        text=True,
        check=check,
        timeout=300,
    )


@pytest.fixture(scope="module")
def container() -> Iterator[str]:
    name = f"nv-parser-test-{uuid.uuid4().hex[:8]}"
    network = f"{name}-net"
    docker("build", "-t", IMAGE, str(SERVICE_DIR))
    docker("network", "create", "--internal", network)
    try:
        docker(
            "run", "-d", "--name", name, "--network", network,
            "--user", "10001:10001", "--read-only", "--tmpfs", TMPFS,
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
            "--memory", "512m", "--cpus", "1", "--pids-limit", "128",
            "-e", f"PARSER_SECRET={SECRET}", IMAGE,
        )  # fmt: skip
        for _ in range(40):
            status = docker("inspect", "-f", "{{.State.Health.Status}}", name).stdout.strip()
            if status == "healthy":
                break
            time.sleep(1)
        else:
            pytest.fail(f"container never became healthy: {docker('logs', name).stdout}")
        yield name
    finally:
        docker("rm", "-f", name, check=False)
        docker("network", "rm", network, check=False)


def run_in(name: str, code: str) -> subprocess.CompletedProcess[str]:
    return docker("exec", name, "python", "-c", code, check=False)


def test_outbound_network_calls_fail(container: str) -> None:
    code = """
import socket, sys
failures = 0
for host, port in (("1.1.1.1", 443), ("8.8.8.8", 53), ("example.com", 443)):
    try:
        socket.create_connection((host, port), timeout=3).close()
    except OSError:
        failures += 1
sys.exit(0 if failures == 3 else 1)
"""
    result = run_in(container, code)
    assert result.returncode == 0, "the container reached the internet"


def test_runs_as_non_root_with_a_read_only_filesystem(container: str) -> None:
    assert docker("exec", container, "id", "-u").stdout.strip() == "10001"
    write = run_in(container, "open('/app/should-not-exist', 'w')")
    assert write.returncode != 0
    assert "Read-only" in write.stderr
    assert run_in(container, "open('/tmp/ok', 'w').write('x')").returncode == 0


def test_serves_requests_with_the_secret_and_refuses_without(container: str) -> None:
    code = f"""
import urllib.request, urllib.error, sys
def call(headers):
    request = urllib.request.Request("http://127.0.0.1:8000/detect", data=b"a,b\\n1,2\\n",
                                     headers=headers, method="POST")
    try:
        return urllib.request.urlopen(request, timeout=20).status
    except urllib.error.HTTPError as error:
        return error.code
print(call({{}}), call({{"X-Parser-Secret": "{SECRET}"}}))
"""
    result = run_in(container, code)
    assert result.stdout.split() == ["401", "200"], result.stderr


def test_compose_file_keeps_the_parser_isolated() -> None:
    env = {**os.environ, "PARSER_SECRET": SECRET}
    for key in (
        "POSTGRES_PASSWORD",
        "IDENTITY_RW_PASSWORD",
        "APP_RW_PASSWORD",
        "WORKER_RW_PASSWORD",
        "MIGRATOR_PASSWORD",
    ):
        env.setdefault(key, "x")
    rendered = subprocess.run(  # noqa: S603
        ["docker", "compose", "-f", str(COMPOSE_FILE), "config", "--format", "json"],  # noqa: S607
        capture_output=True, text=True, check=True, env=env,
    )  # fmt: skip
    config = json.loads(rendered.stdout)
    parser = config["services"]["parser"]
    assert parser["read_only"] is True
    assert parser["user"] == "10001:10001"
    assert parser["cap_drop"] == ["ALL"]
    assert not parser.get("volumes"), "the parser must not mount volumes"
    assert not parser.get("ports"), "the parser itself is never published"
    assert list(parser["networks"]) == ["parser-internal"]
    assert config["networks"]["parser-internal"]["internal"] is True
    assert parser["mem_limit"] and parser["cpus"] and parser["pids_limit"]
    assert set(parser["environment"]) == {"PARSER_SECRET"}, "no database credentials"
    published = config["services"]["parser-gateway"]["ports"]
    assert [p["host_ip"] for p in published] == ["127.0.0.1"]
