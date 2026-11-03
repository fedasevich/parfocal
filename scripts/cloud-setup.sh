#!/usr/bin/env bash
set -euo pipefail

NODE_MAJOR="$(cat "$(dirname "$0")/../.node-version")"
PYTHON_VERSION="$(cat "$(dirname "$0")/../.python-version")"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BIN=/root/.local/bin
mkdir -p "$BIN"

if ! node -v 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  tarball="$(curl -sSfL "$base/SHASUMS256.txt" | awk '/linux-x64.tar.xz$/ {print $2}')"
  curl -sSfL "$base/$tarball" -o "/tmp/$tarball"
  tar -xJf "/tmp/$tarball" -C /opt
  rm "/tmp/$tarball"
  ln -sf "/opt/${tarball%.tar.xz}/bin/"{node,npm,npx,corepack} "$BIN/"
fi
export PATH="$BIN:$PATH"
corepack enable --install-directory "$BIN"

uv python install "$PYTHON_VERSION"

if ! command -v betterleaks >/dev/null; then
  v="$(grep -oP 'BETTERLEAKS_VERSION: \K[0-9.]+' "$REPO/.github/workflows/ci.yml")"
  sum="$(grep -oP 'BETTERLEAKS_SHA256: \K[0-9a-f]+' "$REPO/.github/workflows/ci.yml")"
  curl -sSfL "https://github.com/betterleaks/betterleaks/releases/download/v${v}/betterleaks_${v}_linux_x64.tar.gz" -o /tmp/betterleaks.tar.gz
  echo "${sum}  /tmp/betterleaks.tar.gz" | sha256sum --check --quiet
  tar -xzf /tmp/betterleaks.tar.gz -C "$BIN" betterleaks
  rm /tmp/betterleaks.tar.gz
fi

cd "$REPO"
pnpm install --frozen-lockfile
uv sync --all-packages
[ -f .env ] || cp .env.example .env

if command -v dockerd >/dev/null && ! docker info >/dev/null 2>&1; then
  (nohup dockerd >/tmp/dockerd.log 2>&1 &)
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker compose pull -q 2>/dev/null || echo "docker images not pulled, db tests unavailable"
