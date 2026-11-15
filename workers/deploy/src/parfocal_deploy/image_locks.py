import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import modal

from parfocal_common.repository import repository_root

REPOSITORY = repository_root(__file__)
UV_VERSION = "0.13.8"
LOCKED_INSTALL_OPTIONS = "--require-hashes --no-deps"
EXPORT_FLAGS = (
    "--frozen",
    "--no-dev",
    "--no-emit-workspace",
    "--no-header",
    "--no-annotate",
)


@dataclass(frozen=True)
class ImageLock:
    path: str
    packages: tuple[str, ...]
    extras: tuple[str, ...] = ()

    def export_command(self) -> list[str]:
        selected = [flag for package in self.packages for flag in ("--package", package)]
        extras = [flag for extra in self.extras for flag in ("--extra", extra)]
        return ["uv", "export", *EXPORT_FLAGS, *selected, *extras]

    def install(self, base: modal.Image, repository: Path = REPOSITORY) -> modal.Image:
        return base.uv_pip_install(
            requirements=[str(repository / self.path)],
            uv_version=UV_VERSION,
            extra_options=LOCKED_INSTALL_OPTIONS,
        )


APP_LOCK = ImageLock(
    "workers/deploy/locks/app.txt", ("parfocal-api", "parfocal-ingest"), extras=("pdf",)
)
ML_LOCK = ImageLock("workers/deploy/locks/ml.txt", ("parfocal-ml",))
LOCKS = (APP_LOCK, ML_LOCK)


def exported(lock: ImageLock, repository: Path = REPOSITORY) -> str:
    return subprocess.run(
        lock.export_command(), cwd=repository, capture_output=True, text=True, check=True
    ).stdout


def committed(lock: ImageLock, repository: Path = REPOSITORY) -> str:
    return (repository / lock.path).read_text()


def canonical(text: str) -> list[str]:
    blocks = re.split(r"\n(?=\S)", text.strip())
    return sorted(" ".join(block.replace("\\", " ").split()) for block in blocks if block)


def stale(repository: Path = REPOSITORY) -> list[str]:
    return [
        lock.path
        for lock in LOCKS
        if canonical(committed(lock, repository)) != canonical(exported(lock, repository))
    ]


def pinned(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for line in text.splitlines():
        requirement = line.split(";")[0].strip().rstrip("\\").strip()
        if "==" in requirement and not requirement.startswith("--hash"):
            name, version = requirement.split("==", 1)
            found[name.strip().lower()] = version.strip()
    return found


def write(repository: Path = REPOSITORY) -> None:
    for lock in LOCKS:
        target = repository / lock.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(exported(lock, repository))


def main(argv: list[str]) -> int:
    if argv[1:] == ["write"]:
        write()
        return 0
    drifted = stale()
    for path in drifted:
        print(f"{path} differs from uv.lock, refresh it with pnpm images:lock", file=sys.stderr)
    return 1 if drifted else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
