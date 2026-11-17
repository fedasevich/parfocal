import importlib
import inspect
from pathlib import Path

import modal
import pytest

from parfocal_common.db import POOL_OVERFLOW, POOL_SIZE
from parfocal_common.repository import repository_root
from parfocal_deploy import modal_app
from parfocal_deploy.image_locks import APP_LOCK, committed, pinned
from parfocal_deploy.modal_app import (
    APP_NAME,
    FUNCTION_SECRETS,
    FUNCTIONS,
    INGEST_FUNCTION,
    INGEST_OPTIONS,
    MAX_DEPLOYED_CRONS,
    PARSE_SANDBOX_OPTIONS,
    SECRETS,
    WEB_CONCURRENCY,
    WEB_ENDPOINT,
    WEB_FUNCTION,
    WEB_OPTIONS,
    app,
)
from parfocal_ingest.settings import (
    INGEST_MEMORY_LIMIT_MIB,
    INGEST_MEMORY_MIB,
    PARSE_MEMORY_MIB,
    PARSE_SECONDS,
)
from parfocal_ml.gpu_pool import POOLS


def test_the_app_registers_the_web_and_ingest_functions() -> None:
    assert app.name == APP_NAME
    assert sorted(FUNCTIONS) == sorted([WEB_FUNCTION, INGEST_FUNCTION])
    assert all(function.app is app for function in FUNCTIONS.values())


def test_ingest_memory_comes_from_the_ingest_settings() -> None:
    assert INGEST_OPTIONS["memory"] == (INGEST_MEMORY_MIB, INGEST_MEMORY_LIMIT_MIB)
    assert INGEST_MEMORY_MIB == 2048


def test_nothing_is_kept_warm_and_every_function_is_bounded() -> None:
    for options in (WEB_OPTIONS, INGEST_OPTIONS):
        assert options["min_containers"] == 0
        assert "buffer_containers" not in options
        assert options["max_containers"] <= 4
    assert all(pool.min_containers == 0 for pool in POOLS)


def test_the_parse_sandbox_blocks_the_network_and_carries_no_secret() -> None:
    accepted = inspect.signature(modal.Sandbox.create).parameters
    assert set(PARSE_SANDBOX_OPTIONS) <= set(accepted)
    assert PARSE_SANDBOX_OPTIONS["block_network"] is True
    assert "secrets" not in PARSE_SANDBOX_OPTIONS
    assert PARSE_SANDBOX_OPTIONS["memory"] == (PARSE_MEMORY_MIB, PARSE_MEMORY_MIB)
    assert PARSE_SANDBOX_OPTIONS["timeout"] == PARSE_SECONDS
    assert "block_network" in inspect.signature(modal.App.function).parameters


def test_secrets_are_attached_per_function_and_not_to_the_app(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    built: list[dict[str, object]] = []
    real_app = modal.App

    def recording_app(*_arguments: object, **options: object) -> modal.App:
        built.append(options)
        return real_app(APP_NAME)

    assert sorted(FUNCTION_SECRETS) == sorted(FUNCTIONS)
    assert all(FUNCTION_SECRETS[name] == SECRETS for name in FUNCTIONS)
    monkeypatch.setattr(modal, "App", recording_app)
    try:
        importlib.reload(modal_app)
    finally:
        monkeypatch.undo()
        importlib.reload(modal_app)
    assert built
    assert all("secrets" not in options for options in built)


def test_the_app_deploys_no_cron() -> None:
    assert "schedule" not in WEB_OPTIONS
    assert "schedule" not in INGEST_OPTIONS
    assert MAX_DEPLOYED_CRONS == 5


def test_the_image_installs_the_app_lock_and_no_workspace_package() -> None:
    found = pinned(committed(APP_LOCK))
    assert {"fastapi", "asyncpg", "openslide-python", "typst"} <= set(found)
    assert not any(name.startswith("parfocal-") for name in found)


def test_the_web_function_refuses_requests_without_the_proxy_token() -> None:
    assert WEB_ENDPOINT == {"requires_proxy_auth": True}


def test_one_web_container_serves_parallel_requests_within_its_database_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    applied: list[dict[str, int]] = []
    real_concurrent = modal.concurrent

    def recording_concurrent(**options: int) -> object:
        applied.append(options)
        return real_concurrent(**options)

    monkeypatch.setattr(modal, "concurrent", recording_concurrent)
    try:
        importlib.reload(modal_app)
    finally:
        monkeypatch.undo()
        importlib.reload(modal_app)
    assert applied == [WEB_CONCURRENCY]
    assert WEB_CONCURRENCY["target_inputs"] <= WEB_CONCURRENCY["max_inputs"]
    assert WEB_CONCURRENCY["max_inputs"] > 1
    assert 2 * WEB_CONCURRENCY["max_inputs"] <= POOL_SIZE + POOL_OVERFLOW


def test_the_app_module_loads_from_the_shallow_path_modal_copies_it_to(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(modal, "is_local", lambda: False)
    source = Path(modal_app.__file__).read_text()
    namespace = {"__file__": "/root/parfocal_deploy/modal_app.py", "__name__": "in_container"}
    exec(compile(source, "/root/parfocal_deploy/modal_app.py", "exec"), namespace)
    assert namespace["APP_NAME"] == APP_NAME


def test_no_deployed_module_climbs_a_fixed_number_of_folders_at_import() -> None:
    root = repository_root(__file__, depth=3)
    deployed = [
        root / "packages/py-common",
        root / "apps/api",
        root / "workers/ingest",
        root / "workers/deploy",
        root / "workers/ml",
    ]
    assert all((project / "src").is_dir() for project in deployed)
    offenders = [
        str(path.relative_to(root))
        for project in deployed
        for path in (project / "src").rglob("*.py")
        if ".parents[" in path.read_text()
    ]
    assert offenders == []


def test_the_served_api_warms_the_deployed_embedder_through_modal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi import FastAPI

    import parfocal_api.app
    from parfocal_common.warm_gate import EMBEDDER_FUNCTION, GPU_POOL_APP, ModalPools, WarmGate

    monkeypatch.setattr(parfocal_api.app, "create_app", FastAPI)
    served = modal_app.serve()
    gate = served.state.warm_gate
    assert isinstance(gate, WarmGate)
    assert isinstance(gate.pools, ModalPools)
    assert (gate.pools.app_name, gate.function_name) == (GPU_POOL_APP, EMBEDDER_FUNCTION)
    assert gate.pools.environment is None
    assert served.state.gpu_pools is gate.pools
