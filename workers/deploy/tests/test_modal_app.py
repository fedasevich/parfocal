from parfocal_deploy.modal_app import (
    APP_NAME,
    FUNCTIONS,
    INGEST_FUNCTION,
    INGEST_OPTIONS,
    MAX_DEPLOYED_CRONS,
    WEB_FUNCTION,
    WEB_OPTIONS,
    app,
    requirements,
)
from parfocal_ingest.settings import INGEST_MEMORY_LIMIT_MIB, INGEST_MEMORY_MIB
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


def test_the_app_deploys_no_cron() -> None:
    assert "schedule" not in WEB_OPTIONS
    assert "schedule" not in INGEST_OPTIONS
    assert MAX_DEPLOYED_CRONS == 5


def test_the_image_installs_what_the_packages_declare_and_no_workspace_package() -> None:
    found = requirements()
    assert any(requirement.startswith("fastapi") for requirement in found)
    assert any(requirement.startswith("asyncpg") for requirement in found)
    assert any(requirement.startswith("openslide-python") for requirement in found)
    assert not any(requirement.startswith("parfocal-") for requirement in found)
