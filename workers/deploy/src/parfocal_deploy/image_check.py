import os
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from parfocal_common.repository import repository_root

REPOSITORY = repository_root(__file__)
PYTHON_VERSION = "3.14"
INSTALL_OPTIONS = ("--require-hashes", "--no-deps")


@dataclass(frozen=True)
class ImageCheck:
    name: str
    lock: str
    sources: tuple[str, ...]
    entrypoints: tuple[str, ...]


APP_IMAGE = ImageCheck(
    "app",
    "workers/deploy/locks/app.txt",
    ("packages/py-common/src", "apps/api/src", "workers/ingest/src"),
    ("parfocal_api.app", "parfocal_ingest.__main__"),
)
ML_IMAGE = ImageCheck(
    "ml",
    "workers/deploy/locks/ml.txt",
    ("packages/py-common/src", "workers/ml/src"),
    ("parfocal_ml.modal_pool", "parfocal_ml.tumor_map_worker", "parfocal_ml.view_map_worker"),
)
IMAGES = {image.name: image for image in (APP_IMAGE, ML_IMAGE)}


@dataclass(frozen=True)
class Step:
    argv: tuple[str, ...]
    pythonpath: str | None = None


def import_script(modules: Sequence[str]) -> str:
    listed = ", ".join(repr(module) for module in modules)
    return f"import importlib\nfor module in ({listed},):\n    importlib.import_module(module)\n"


def steps(image: ImageCheck, environment: Path, repository: Path = REPOSITORY) -> list[Step]:
    python = str(environment / "bin" / "python")
    return [
        Step(("uv", "venv", "--python", PYTHON_VERSION, str(environment))),
        Step(
            (
                "uv",
                "pip",
                "install",
                "--python",
                python,
                *INSTALL_OPTIONS,
                "-r",
                str(repository / image.lock),
            )
        ),
        Step(
            (python, "-P", "-c", import_script(image.entrypoints)),
            os.pathsep.join(str(repository / source) for source in image.sources),
        ),
    ]


def run(step: Step) -> None:
    environment = dict(os.environ)
    if step.pythonpath is not None:
        environment["PYTHONPATH"] = step.pythonpath
    subprocess.run(step.argv, env=environment, check=True)


def main(argv: Sequence[str]) -> int:
    names = list(argv[1:]) or list(IMAGES)
    unknown = [name for name in names if name not in IMAGES]
    if unknown:
        print(f"unknown image {', '.join(unknown)}, pick from {', '.join(IMAGES)}", file=sys.stderr)
        return 2
    for name in names:
        with tempfile.TemporaryDirectory(prefix=f"parfocal-{name}-image-") as directory:
            for step in steps(IMAGES[name], Path(directory) / "venv"):
                run(step)
        print(f"the {name} image installs its lock and imports its entry modules")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
