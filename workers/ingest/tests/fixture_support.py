import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "packages" / "test-fixtures" / "fixtures.json"
SYNTHETIC = ROOT / "packages" / "test-fixtures" / "synthetic"


def cache_dir() -> Path:
    override = os.environ.get("PARFOCAL_FIXTURES_DIR")
    if override:
        return Path(override)
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "parfocal" / "fixtures"


def groups_of(name: str) -> set[str]:
    manifest = json.loads(MANIFEST.read_text())
    for entry in manifest["remote"]:
        if entry["file"] == name:
            return set(entry["groups"])
    raise KeyError(name)


def required_groups() -> set[str]:
    value = os.environ.get("PARFOCAL_REQUIRE_FIXTURES", "")
    return {group.strip() for group in value.split(",") if group.strip()}


def fixture_path(name: str) -> Path:
    if (SYNTHETIC / name).exists():
        return SYNTHETIC / name
    path = cache_dir() / name
    if path.exists():
        return path
    groups = groups_of(name)
    message = f"{name} is not downloaded. Run pnpm fixtures {' '.join(sorted(groups))}"
    if groups & required_groups():
        raise AssertionError(message)
    pytest.skip(message)
