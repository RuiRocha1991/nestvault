"""Runs one detect/parse job in a throw-away child process.

The file is untrusted, so everything that reads it (sniffing, parsing) happens in a child that is
killed when the time limit is reached and that is given a CPU limit of its own. A Python thread
cannot be interrupted, a process can.
"""

import logging
import multiprocessing
import resource
from collections.abc import Callable
from dataclasses import dataclass
from multiprocessing.connection import Connection
from typing import Any, Literal

from .config import Settings
from .errors import JobTimeoutError, ParseFailedError, ParserError
from .models import DetectResponse, ParseResponse
from .registry import Registry
from .sniff import sniff

log = logging.getLogger("parser_service.jobs")

RegistryFactory = Callable[[], Registry]


@dataclass(frozen=True)
class Job:
    kind: Literal["detect", "parse"]
    data: bytes
    settings: Settings
    registry_factory: RegistryFactory
    parser_id: str | None = None


def execute(job: Job) -> dict[str, Any]:
    """The work itself; runs inside the child process (and directly in unit tests)."""
    file = sniff(job.data, job.settings)
    registry = job.registry_factory()
    if job.kind == "detect":
        return DetectResponse(results=registry.detect(file)).model_dump(mode="json")
    if job.parser_id is None:
        raise ParseFailedError("A parser id is required.")
    response = registry.get(job.parser_id).parse(file)
    # Parsers build models, but re-validate so a buggy parser can never emit a malformed row.
    return ParseResponse.model_validate(response.model_dump()).model_dump(mode="json")


def _child(connection: Connection, job: Job) -> None:
    cpu = int(job.settings.job_timeout_seconds) + 1
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    try:
        connection.send(("ok", execute(job)))
    except ParserError as exc:
        connection.send(("error", exc.status, exc.code, exc.message, type(exc).__name__))
    except Exception as exc:  # never forward the message: it could quote the file
        connection.send(
            ("error", 422, "parse_failed", ParseFailedError().message, type(exc).__name__)
        )
    finally:
        connection.close()


def run_isolated(job: Job) -> dict[str, Any]:
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_child, args=(sender, job), daemon=True)
    process.start()
    sender.close()
    timeout = job.settings.job_timeout_seconds
    try:
        if not receiver.poll(timeout):
            raise JobTimeoutError(timeout)
        try:
            message = receiver.recv()
        except EOFError:
            raise ParserError(500, "worker_crashed", "The worker stopped unexpectedly.") from None
    finally:
        receiver.close()
        if process.is_alive():
            process.kill()
        process.join(2)
    if message[0] == "ok":
        result: dict[str, Any] = message[1]
        return result
    _, status, code, text, error_type = message
    log.warning("job %s failed: %s (%s)", job.kind, code, error_type)
    raise ParserError(status, code, text)
