"""HTTP surface. Internal only: the container is on a network without egress and without a
published port; callers prove themselves with the shared secret."""

import asyncio
import base64
import binascii
import hmac
import json
import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .config import Settings
from .engine.propose import ProposeResponse
from .engine.spec import ImportSpec
from .errors import FileTooLargeError, ParserError
from .jobs import Job, RegistryFactory, run_isolated
from .limits import read_limited
from .models import (
    DetectResponse,
    ErrorResponse,
    ParseResponse,
    ParsersResponse,
)
from .registry import default_registry

log = logging.getLogger("parser_service")

MAX_SPEC_HEADER = 12_000
ParserId = Annotated[str, Query(pattern=r"^[a-z0-9][a-z0-9._-]{0,63}$")]


def _error(status: int, code: str, message: str) -> JSONResponse:
    body = ErrorResponse(code=code, message=message)
    return JSONResponse(status_code=status, content=body.model_dump())


def create_app(settings: Settings, registry_factory: RegistryFactory = default_registry) -> FastAPI:
    app = FastAPI(title="NestVault parser", docs_url=None, redoc_url=None, openapi_url=None)
    registry = registry_factory()
    slots = asyncio.Semaphore(settings.max_concurrent_jobs)
    secret = settings.secret.encode()

    async def require_secret(
        x_parser_secret: Annotated[str | None, Header()] = None,
    ) -> None:
        given = (x_parser_secret or "").encode()
        if not hmac.compare_digest(given, secret):
            raise ParserError(401, "unauthorized", "Missing or invalid credentials.")

    guarded = [Depends(require_secret)]

    @app.exception_handler(ParserError)
    async def parser_error(_request: Request, exc: ParserError) -> JSONResponse:
        return _error(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        # The default body echoes the rejected input; ours never does.
        return _error(422, "invalid_request", "The request is not valid.")

    async def read_body(request: Request) -> bytes:
        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > settings.max_file_bytes:
            raise FileTooLargeError(settings.max_file_bytes)
        return await read_limited(request.stream(), settings.max_file_bytes)

    async def run(job: Job) -> dict[str, object]:
        async with slots:
            return await asyncio.to_thread(run_isolated, job)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/parsers", dependencies=guarded)
    async def parsers() -> ParsersResponse:
        return ParsersResponse(parsers=registry.info())

    @app.post("/detect", dependencies=guarded)
    async def detect(request: Request) -> DetectResponse:
        data = await read_body(request)
        result = await run(Job("detect", data, settings, registry_factory))
        return DetectResponse.model_validate(result)

    @app.post("/parse", dependencies=guarded)
    async def parse(request: Request, parser_id: ParserId) -> ParseResponse:
        registry.get(parser_id)  # 404 before any work on the file
        data = await read_body(request)
        result = await run(Job("parse", data, settings, registry_factory, parser_id))
        return ParseResponse.model_validate(result)

    @app.post("/parse-spec", dependencies=guarded)
    async def parse_spec(
        request: Request, x_import_spec: Annotated[str, Header(max_length=MAX_SPEC_HEADER)]
    ) -> ParseResponse:
        """Parse with a spec sent by the caller (the column mapping a user confirmed for an
        account). The spec travels base64url-encoded in `X-Import-Spec` because the body is the
        file; it is validated against the strict schema before any work on the file."""
        spec = _decode_spec(x_import_spec)
        data = await read_body(request)
        result = await run(Job("parse-spec", data, settings, registry_factory, spec=spec))
        return ParseResponse.model_validate(result)

    @app.post("/propose", dependencies=guarded)
    async def propose_mapping(request: Request) -> ProposeResponse:
        data = await read_body(request)
        result = await run(Job("propose", data, settings, registry_factory))
        return ProposeResponse.model_validate(result)

    return app


def _decode_spec(header: str) -> dict[str, object]:
    try:
        raw = base64.urlsafe_b64decode(header + "=" * (-len(header) % 4))
        document = json.loads(raw)
        ImportSpec.model_validate(document)
    except (binascii.Error, ValueError, ValidationError):  # JSON errors are ValueErrors
        raise ParserError(422, "invalid_spec", "The import spec is not valid.") from None
    if not isinstance(document, dict):
        raise ParserError(422, "invalid_spec", "The import spec is not valid.")
    return document
