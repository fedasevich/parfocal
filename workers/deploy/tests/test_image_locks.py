import re
import shutil
from pathlib import Path

import pytest
from packaging.requirements import Requirement

from parfocal_deploy import image_locks
from parfocal_deploy.image_locks import (
    APP_LOCK,
    LOCKED_INSTALL_OPTIONS,
    LOCKS,
    ML_LOCK,
    REPOSITORY,
    UV_VERSION,
    committed,
    exported,
    pinned,
    stale,
)
from parfocal_deploy.modal_app import PROJECTS, project_requirements
from parfocal_ml import modal_pool


def test_every_image_lock_matches_what_uv_lock_exports() -> None:
    assert stale() == []


def test_a_lock_that_differs_from_uv_lock_is_reported(tmp_path: Path) -> None:
    shutil.copy(REPOSITORY / "uv.lock", tmp_path / "uv.lock")
    shutil.copy(REPOSITORY / "pyproject.toml", tmp_path / "pyproject.toml")
    members = ("apps/api", "packages/py-common", "workers/ingest", "workers/ml", "workers/deploy")
    for member in members:
        (tmp_path / member).mkdir(parents=True)
        shutil.copy(REPOSITORY / member / "pyproject.toml", tmp_path / member / "pyproject.toml")
    for lock in LOCKS:
        (tmp_path / lock.path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / lock.path).write_text(committed(lock))
    assert stale(tmp_path) == []
    tampered = committed(APP_LOCK).replace("fastapi==", "fastapi==0.0.1+", 1)
    (tmp_path / APP_LOCK.path).write_text(tampered)
    assert stale(tmp_path) == [APP_LOCK.path]


def test_the_app_lock_pins_every_dependency_the_deployed_projects_declare() -> None:
    locked = pinned(committed(APP_LOCK))
    declared = {
        Requirement(requirement).name.lower()
        for project in PROJECTS
        for requirement in project_requirements(REPOSITORY / project)
    }
    assert declared <= set(locked)
    assert not any(name.startswith("parfocal-") for name in locked)


def test_every_locked_line_carries_a_hash() -> None:
    for lock in LOCKS:
        blocks = re.split(r"\n(?=\S)", committed(lock).strip())
        assert len(blocks) == len(pinned(committed(lock)))
        assert all("--hash=sha256:" in block for block in blocks)
    assert "--require-hashes" in LOCKED_INSTALL_OPTIONS


def test_the_ml_image_reads_the_ml_lock_with_the_same_installer() -> None:
    assert ML_LOCK.path == modal_pool.LOCK_PATH
    assert modal_pool.UV_VERSION == UV_VERSION
    assert modal_pool.LOCKED_INSTALL_OPTIONS == LOCKED_INSTALL_OPTIONS
    assert "@sha256:" in modal_pool.CUDA_BASE
    assert "torch" not in pinned(committed(ML_LOCK))


def test_the_check_command_fails_on_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(image_locks, "stale", lambda: [APP_LOCK.path])
    assert image_locks.main(["image_locks"]) == 1
    monkeypatch.setattr(image_locks, "stale", list)
    assert image_locks.main(["image_locks"]) == 0


def test_the_export_names_each_package_and_extra() -> None:
    command = APP_LOCK.export_command()
    assert command[:3] == ["uv", "export", "--frozen"]
    assert command[-6:-4] == ["--package", "parfocal-api"]
    assert command[-2:] == ["--extra", "pdf"]
    assert exported(ML_LOCK) == committed(ML_LOCK)
