import os
from pathlib import Path

ROOT_VARIABLE = "PARFOCAL_REPOSITORY_ROOT"


def repository_root(module_file: str, depth: int = 4) -> Path:
    if named := os.environ.get(ROOT_VARIABLE):
        return Path(named)
    path = Path(module_file).resolve()
    for _ in range(depth + 1):
        path = path.parent
    return path
