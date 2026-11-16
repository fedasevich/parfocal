#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" != "--inside" ]; then
  repository="$(cd "$(dirname "$0")/../../.." && pwd)"
  exec docker run --rm --name parfocal-parse-as-root --memory 3g \
    -v "$repository:/src:ro" python:3.14-slim \
    bash /src/workers/ingest/scripts/test-as-root.sh --inside "$@"
fi
shift

mkdir -p /work
cd /src
tar --exclude=node_modules --exclude=.venv --exclude=__pycache__ --exclude=.git -cf - \
  pyproject.toml uv.lock .python-version apps/api packages/py-common packages/test-fixtures \
  workers scripts | tar -xf - -C /work
cd /work
pip install -q --root-user-action=ignore uv
export UV_PYTHON_DOWNLOADS=never UV_PYTHON=/usr/local/bin/python3.14 UV_LINK_MODE=copy
uv sync -q --frozen --package parfocal-ingest
uv pip install -q --python .venv/bin/python "pytest>=9.1,<10" "pytest-asyncio>=1.4,<2"
chmod -R a+rX /work
mkdir -p /pt
chmod 755 /pt
.venv/bin/python -m pytest -p no:cacheprovider --basetemp=/pt/base -q -rA \
  workers/ingest/tests/test_isolation.py "$@"
