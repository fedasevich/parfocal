import asyncio
import importlib
import inspect
import uuid
from pathlib import Path
from typing import Any, cast

import modal
import pytest
from sqlalchemy.ext.asyncio import AsyncConnection

import parfocal_common.jobs
from parfocal_common.db import POOL_OVERFLOW, POOL_SIZE
from parfocal_common.jobs import enqueue, load_workflow, no_job_wake
from parfocal_common.repository import repository_root
from parfocal_deploy import modal_app
from parfocal_deploy.image_locks import APP_LOCK, committed, pinned
from parfocal_deploy.modal_app import (
    APP_NAME,
    BACKFILL_FUNCTION,
    CROPS_BACKFILL_FUNCTION,
    EVENTS_FUNCTION,
    EVENTS_LINGER_MINUTES,
    EVENTS_OPTIONS,
    EVENTS_PERIOD_MINUTES,
    EVENTS_SPAWN_GAP_SECONDS,
    FUNCTION_SECRETS,
    FUNCTIONS,
    INGEST_DRAINED_KINDS,
    INGEST_FUNCTION,
    INGEST_IDLE_EXIT_SECONDS,
    INGEST_OPTIONS,
    INGEST_PERIOD_MINUTES,
    INGEST_SPAWN_GAP_SECONDS,
    LEVELS_BACKFILL_FUNCTION,
    MAX_DEPLOYED_CRONS,
    PARSE_SANDBOX_OPTIONS,
    PRELOAD_VARIABLE,
    SECRETS,
    WEB_CLOUD,
    WEB_CONCURRENCY,
    WEB_ENDPOINT,
    WEB_FUNCTION,
    WEB_OPTIONS,
    WEB_PRELOAD,
    WEB_REGION,
    WEB_ROUTING_REGION,
    WORKER_REGION,
    EventSpawner,
    IngestSpawner,
    app,
)
from parfocal_ingest.__main__ import DEFAULT_WORKFLOWS
from parfocal_ingest.settings import (
    INGEST_MEMORY_LIMIT_MIB,
    INGEST_MEMORY_MIB,
    PARSE_MEMORY_MIB,
    PARSE_SECONDS,
)
from parfocal_ml.gpu_pool import POOLS


def test_the_app_registers_the_web_and_ingest_functions() -> None:
    assert app.name == APP_NAME
    assert sorted(FUNCTIONS) == sorted(
        [
            WEB_FUNCTION,
            INGEST_FUNCTION,
            EVENTS_FUNCTION,
            BACKFILL_FUNCTION,
            CROPS_BACKFILL_FUNCTION,
            LEVELS_BACKFILL_FUNCTION,
        ]
    )
    assert all(function.app is app for function in FUNCTIONS.values())


def test_ingest_memory_comes_from_the_ingest_settings() -> None:
    assert INGEST_OPTIONS["memory"] == (INGEST_MEMORY_MIB, INGEST_MEMORY_LIMIT_MIB)
    assert INGEST_MEMORY_MIB == 2048


def test_nothing_is_kept_warm_and_every_function_is_bounded() -> None:
    for options in (WEB_OPTIONS, INGEST_OPTIONS, EVENTS_OPTIONS):
        assert options["min_containers"] == 0
        assert "buffer_containers" not in options
        assert options["max_containers"] <= 4
    assert all(pool.min_containers == 0 for pool in POOLS)


def test_only_the_web_function_is_pinned_narrow_and_enters_at_dublin() -> None:
    assert (WEB_REGION, WEB_ROUTING_REGION) == ("eu-west", "eu-west")
    assert WEB_OPTIONS["region"] == WEB_REGION
    assert WEB_OPTIONS["routing_region"] == WEB_ROUTING_REGION
    assert WEB_OPTIONS["cloud"] == WEB_CLOUD == "gcp"
    for options in (INGEST_OPTIONS, EVENTS_OPTIONS):
        assert "routing_region" not in options


def test_ingest_and_events_run_in_the_eu_beside_the_database() -> None:
    assert WORKER_REGION == "eu"
    for options in (INGEST_OPTIONS, EVENTS_OPTIONS):
        assert options["region"] == WORKER_REGION


def test_only_the_web_function_restores_from_a_memory_snapshot() -> None:
    assert WEB_OPTIONS["enable_memory_snapshot"] is True
    assert "enable_memory_snapshot" not in INGEST_OPTIONS
    assert "enable_memory_snapshot" not in EVENTS_OPTIONS


def test_the_web_container_imports_the_api_before_its_snapshot() -> None:
    loaded: list[str] = []
    modal_app.preload({PRELOAD_VARIABLE: WEB_FUNCTION}, loaded.append)
    assert loaded == list(WEB_PRELOAD)
    assert "parfocal_api.app" in WEB_PRELOAD
    for module in WEB_PRELOAD:
        importlib.import_module(module)


def test_the_snapshot_holds_the_database_driver_and_http_stack_the_app_loads_at_startup() -> None:
    for module in ("sqlalchemy.dialects.postgresql.asyncpg", "asyncpg", "httpcore2", "truststore"):
        assert module in WEB_PRELOAD


def test_the_served_api_logs_how_long_startup_took(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from fastapi import FastAPI

    import parfocal_api.app

    monkeypatch.setattr(parfocal_api.app, "create_app", FastAPI)
    monkeypatch.setattr(parfocal_common.jobs, "JOB_WAKERS", [no_job_wake])
    caplog.set_level("INFO", logger=modal_app.STARTUP_LOGGER)
    app = modal_app.serve()

    async def start_and_stop() -> None:
        async with app.router.lifespan_context(app):
            pass

    asyncio.run(start_and_stop())
    created, ready = caplog.records
    assert created.getMessage() == "web app created"
    assert created.__dict__["create_app_ms"] <= created.__dict__["serve_ms"]
    assert ready.getMessage() == "web ready"
    assert ready.__dict__["lifespan_ms"] >= 0
    from parfocal_common.scrubbing import ALLOWED_FIELDS

    assert {"serve_ms", "create_app_ms", "lifespan_ms"} <= ALLOWED_FIELDS


def test_other_containers_and_local_runs_skip_the_api_preload() -> None:
    loaded: list[str] = []
    modal_app.preload({}, loaded.append)
    modal_app.preload({PRELOAD_VARIABLE: INGEST_FUNCTION}, loaded.append)
    assert loaded == []


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


def test_the_app_deploys_hourly_schedules_for_the_event_sweep_and_the_job_drain() -> None:
    scheduled = [
        options
        for options in (WEB_OPTIONS, INGEST_OPTIONS, EVENTS_OPTIONS)
        if "schedule" in options
    ]
    assert scheduled == [INGEST_OPTIONS, EVENTS_OPTIONS]
    assert len(scheduled) <= MAX_DEPLOYED_CRONS == 5
    assert EVENTS_PERIOD_MINUTES == INGEST_PERIOD_MINUTES == 60
    assert isinstance(EVENTS_OPTIONS["schedule"], modal.Period)
    assert isinstance(INGEST_OPTIONS["schedule"], modal.Period)
    assert EVENTS_OPTIONS["max_containers"] == 1
    assert INGEST_OPTIONS["min_containers"] == 0


def test_the_ingest_spawner_knows_exactly_the_kinds_the_worker_drains() -> None:
    drained = {load_workflow(path).kind for path in DEFAULT_WORKFLOWS}
    assert drained == INGEST_DRAINED_KINDS


def test_a_queued_job_spawns_the_worker_once_within_the_gap() -> None:
    spawned: list[int] = []
    now = [100.0]

    async def spawn() -> None:
        spawned.append(1)

    spawner = IngestSpawner(spawn, lambda: now[0])
    asyncio.run(spawner("review-order"))
    asyncio.run(spawner("ingest"))
    assert spawned == [1]
    now[0] += INGEST_SPAWN_GAP_SECONDS
    asyncio.run(spawner("review-order"))
    assert spawned == [1, 1]
    assert INGEST_SPAWN_GAP_SECONDS < INGEST_IDLE_EXIT_SECONDS


class QueuingConnection:
    async def scalar(self, statement: Any) -> uuid.UUID:
        return uuid.uuid4()

    async def execute(self, statement: Any, rows: Any = None) -> None:
        return None


def test_the_served_api_spawns_the_worker_once_for_two_jobs_queued_within_the_gap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi import FastAPI

    import parfocal_api.app
    from parfocal_api.review_order_job import REVIEW_ORDER

    spawned: list[int] = []

    async def spawn() -> None:
        spawned.append(1)

    monkeypatch.setattr(parfocal_api.app, "create_app", FastAPI)
    monkeypatch.setattr(modal_app, "spawn_ingest", lambda: IngestSpawner(spawn, lambda: 0.0))
    monkeypatch.setattr(parfocal_common.jobs, "JOB_WAKERS", [no_job_wake])
    modal_app.serve()
    connection = cast("AsyncConnection", QueuingConnection())
    asyncio.run(enqueue(connection, REVIEW_ORDER, uuid.uuid4()))
    asyncio.run(enqueue(connection, REVIEW_ORDER, uuid.uuid4()))
    assert spawned == [1]


def test_a_job_the_worker_does_not_drain_spawns_nothing() -> None:
    spawned: list[int] = []

    async def spawn() -> None:
        spawned.append(1)

    spawner = IngestSpawner(spawn, lambda: 0.0)
    asyncio.run(spawner("model-run"))
    asyncio.run(spawner("retention"))
    assert spawned == []


def test_a_failed_ingest_spawn_is_tried_again_at_the_next_job() -> None:
    attempts: list[int] = []

    async def spawn() -> None:
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("modal is down")

    spawner = IngestSpawner(spawn, lambda: 0.0)
    with pytest.raises(RuntimeError):
        asyncio.run(spawner("ingest"))
    asyncio.run(spawner("ingest"))
    assert len(attempts) == 2


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
    monkeypatch.setattr(parfocal_common.jobs, "JOB_WAKERS", [no_job_wake])
    served = modal_app.serve()
    gate = served.state.warm_gate
    assert isinstance(gate, WarmGate)
    assert isinstance(gate.pools, ModalPools)
    assert (gate.pools.app_name, gate.function_name) == (GPU_POOL_APP, EMBEDDER_FUNCTION)
    assert gate.pools.environment is None
    assert served.state.gpu_pools is gate.pools


def test_the_spawner_starts_a_lingering_sweep_and_not_a_second_one_within_the_gap() -> None:
    spawned: list[int] = []
    now = [100.0]

    async def spawn(linger: int) -> None:
        spawned.append(linger)

    spawner = EventSpawner(spawn, lambda: now[0])
    asyncio.run(spawner())
    asyncio.run(spawner())
    assert spawned == [EVENTS_LINGER_MINUTES]
    now[0] += EVENTS_SPAWN_GAP_SECONDS
    asyncio.run(spawner())
    assert spawned == [EVENTS_LINGER_MINUTES] * 2


def test_a_failed_spawn_is_tried_again_at_the_next_event() -> None:
    attempts: list[int] = []

    async def spawn(linger: int) -> None:
        attempts.append(linger)
        if len(attempts) == 1:
            raise RuntimeError("modal is down")

    spawner = EventSpawner(spawn, lambda: 0.0)
    with pytest.raises(RuntimeError):
        asyncio.run(spawner())
    asyncio.run(spawner())
    assert len(attempts) == 2


def test_the_hourly_event_run_also_sweeps_the_remote_tile_caches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import parfocal_api.event_delivery

    calls: list[str] = []
    monkeypatch.setattr(
        parfocal_api.event_delivery, "main", lambda argv: calls.append(f"events {argv[-1]}")
    )
    monkeypatch.setattr(modal_app, "sweep_remote_caches", lambda: calls.append("caches"))
    modal_app.run_events()
    modal_app.run_events(EVENTS_LINGER_MINUTES)
    assert calls == ["events 0", "caches", f"events {EVENTS_LINGER_MINUTES}"]


def test_the_cache_sweep_runs_one_pass_with_the_api_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import parfocal_api.remote_cache_sweep
    import parfocal_common.settings
    from parfocal_api.settings import ApiSettings

    settings = object()
    passes: list[object] = []

    async def run_once(given: object) -> int:
        passes.append(given)
        return 0

    def load(kind: type) -> object:
        assert kind is ApiSettings
        return settings

    monkeypatch.setattr(parfocal_common.settings, "load_settings", load)
    monkeypatch.setattr(parfocal_api.remote_cache_sweep, "run_once", run_once)
    modal_app.sweep_remote_caches()
    assert passes == [settings]
