FROM ghcr.io/astral-sh/uv:0.13.8@sha256:5cc1805e2426484abca4ad46ea783bab281fdb225fd82d8ce6d66a81254bac85 AS uv

FROM python:3.14.9-slim-trixie@sha256:35caba83af2fe6da9a5d922f9b0156f21d1246a48278c58a08bd253303ba42e8 AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
COPY uv.lock pyproject.toml ./
COPY apps/api/pyproject.toml apps/api/
COPY packages/py-common/pyproject.toml packages/py-common/
COPY workers/ingest/pyproject.toml workers/ingest/
COPY workers/ml/pyproject.toml workers/ml/
COPY workers/deploy/pyproject.toml workers/deploy/
RUN uv sync --frozen --no-dev --package parfocal-api --extra pdf --group serve --no-install-workspace
COPY packages/py-common/src packages/py-common/src
COPY apps/api/src apps/api/src
RUN uv sync --frozen --no-dev --package parfocal-api --extra pdf --group serve --no-editable

FROM python:3.14.9-slim-trixie@sha256:35caba83af2fe6da9a5d922f9b0156f21d1246a48278c58a08bd253303ba42e8 AS runtime
RUN python -m pip uninstall --yes --quiet pip \
    && groupadd --system --gid 10001 parfocal \
    && useradd --system --uid 10001 --gid parfocal --home-dir /app --no-create-home parfocal
COPY --from=build /opt/venv /opt/venv
COPY apps/api/alembic.ini /app/alembic.ini
COPY apps/api/migrations /app/migrations
COPY --chmod=0755 apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000
WORKDIR /app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health', timeout=2)"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
