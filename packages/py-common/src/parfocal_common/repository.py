from pathlib import Path


def repository_root(module_file: str, depth: int = 4) -> Path:
    path = Path(module_file).resolve()
    for _ in range(depth + 1):
        path = path.parent
    return path
