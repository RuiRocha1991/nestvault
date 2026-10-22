# Parser service image. Runs as a non-root user; the compose file adds a read-only root filesystem,
# a tmpfs for /tmp, an internal-only network (no egress), no volumes and CPU/memory limits.
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY specs ./specs
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
RUN groupadd --system --gid 10001 parser \
 && useradd --system --uid 10001 --gid parser --no-create-home --shell /usr/sbin/nologin parser
WORKDIR /app
COPY --from=build --chown=parser:parser /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 TMPDIR=/tmp
USER parser
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"]
CMD ["uvicorn", "parser_service.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--no-access-log"]
