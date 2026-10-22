"""HTTP surface. Internal only: the container is on a network without egress and without a
published port; callers prove themselves with the shared secret."""

import asyncio
import hmac
import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Settings
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

    return app
