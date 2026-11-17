import re
import subprocess
from pathlib import Path

import modal
import pytest

from parfocal_deploy import image_check, modal_app
from parfocal_deploy.image_check import (
    APP_IMAGE,
    IMAGES,
    INSTALL_OPTIONS,
    ML_IMAGE,
    PYTHON_VERSION,
    REPOSITORY,
    ImageCheck,
    Step,
    import_script,
    locked_version,
    main,
    steps,
)
from parfocal_deploy.image_locks import APP_LOCK, LOCKED_INSTALL_OPTIONS, ML_LOCK
from parfocal_ml import modal_pool

WORKFLOW = REPOSITORY / ".github" / "workflows" / "ci.yml"
API_DOCKERFILE = REPOSITORY / "apps" / "api" / "Dockerfile"


def modal_images_job() -> str:
    text = WORKFLOW.read_text()
    start = text.index("\n  modal-images:\n")
    following = re.search(r"\n  [a-z][a-z-]*:\n", text[start + 1 :])
    assert following is not None
    return text[start : start + 1 + following.start()]


def test_the_check_installs_the_same_locks_with_the_same_options_as_modal() -> None:
    assert APP_IMAGE.lock == APP_LOCK.path
    assert ML_IMAGE.lock == ML_LOCK.path == modal_pool.LOCK_PATH
    assert " ".join(INSTALL_OPTIONS) == LOCKED_INSTALL_OPTIONS == modal_pool.LOCKED_INSTALL_OPTIONS
    assert PYTHON_VERSION == modal_app.PYTHON_VERSION == modal_pool.PYTHON_VERSION


def packages_on_the_path(image: ImageCheck) -> set[str]:
    return {
        package.name
        for source in image.sources
        for package in (REPOSITORY / source).iterdir()
        if (package / "__init__.py").is_file()
    }


def test_the_check_puts_every_deployed_source_on_the_path() -> None:
    assert packages_on_the_path(APP_IMAGE) == set(modal_app.SOURCES)
    assert packages_on_the_path(ML_IMAGE) == {"parfocal_common", "parfocal_ml"}
    assert "parfocal_common.warm_gate" in APP_IMAGE.entrypoints
    assert "parfocal_deploy.modal_app" in APP_IMAGE.entrypoints
    for image in IMAGES.values():
        for source in image.sources:
            assert (REPOSITORY / source).is_dir()
        for module in image.entrypoints:
            package = module.split(".")[0]
            assert any((REPOSITORY / source / package).is_dir() for source in image.sources)


def test_the_steps_create_install_and_import_in_order(tmp_path: Path) -> None:
    environment = tmp_path / "venv"
    create, install, load = steps(ML_IMAGE, environment, tmp_path)
    python = str(environment / "bin" / "python")
    assert create == Step(("uv", "venv", "--python", PYTHON_VERSION, str(environment)))
    assert install.argv == (
        "uv",
        "pip",
        "install",
        "--python",
        python,
        "--require-hashes",
        "--no-deps",
        "-r",
        str(tmp_path / ML_IMAGE.lock),
    )
    assert install.pythonpath is None
    assert load.argv[:3] == (python, "-P", "-c")
    assert load.pythonpath is not None
    assert load.pythonpath.split(":") == [str(tmp_path / source) for source in ML_IMAGE.sources]


def test_the_app_check_adds_the_modal_client_that_modal_mounts(tmp_path: Path) -> None:
    create, install, client, load = steps(APP_IMAGE, tmp_path / "venv")
    assert install.argv[-1] == str(REPOSITORY / APP_IMAGE.lock)
    assert client.argv[-1] == f"modal=={locked_version('modal')}"
    assert client.argv[-1] == f"modal=={modal.__version__}"
    assert create.argv[:2] == ("uv", "venv")
    assert load.pythonpath is not None


def test_a_package_missing_from_uv_lock_is_reported(tmp_path: Path) -> None:
    (tmp_path / "uv.lock").write_text('[[package]]\nname = "numpy"\nversion = "2.5.4"\n')
    assert locked_version("numpy", tmp_path) == "2.5.4"
    with pytest.raises(LookupError):
        locked_version("modal", tmp_path)


def test_the_import_script_imports_each_module() -> None:
    script = import_script(("json", "this_module_does_not_exist"))
    with pytest.raises(ModuleNotFoundError):
        exec(compile(script, "<image-check>", "exec"), {})
    exec(compile(import_script(("json", "csv")), "<image-check>", "exec"), {})


def test_run_passes_the_sources_only_to_the_import_step(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[tuple[str, ...], str | None]] = []

    def record(argv: tuple[str, ...], env: dict[str, str], check: bool) -> None:
        assert check is True
        seen.append((argv, env.get("PYTHONPATH")))

    monkeypatch.delenv("PYTHONPATH", raising=False)
    monkeypatch.setattr(subprocess, "run", record)
    image_check.run(Step(("uv", "venv")))
    image_check.run(Step(("python", "-c", "pass"), "/sources"))
    assert seen == [(("uv", "venv"), None), (("python", "-c", "pass"), "/sources")]


def test_an_unknown_image_name_is_refused(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["image_check", "gpu"]) == 2
    assert "unknown image gpu" in capsys.readouterr().err


def test_ci_runs_each_image_on_the_pinned_cuda_and_api_python_bases() -> None:
    job = modal_images_job()
    python_base = re.search(r"^FROM (python:\S+) AS runtime$", API_DOCKERFILE.read_text(), re.M)
    assert python_base is not None
    assert f"base: {python_base.group(1)}" in job
    assert f"base: {modal_pool.CUDA_BASE}" in job
    for name in IMAGES:
        assert f"image: {name}" in job
    assert "python -m parfocal_deploy.image_check" in job
