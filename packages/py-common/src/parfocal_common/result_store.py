from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class MissingObjectError(LookupError):
    pass


class ResultStore(Protocol):
    def get(self, object_key: str) -> bytes: ...


@dataclass(frozen=True)
class LocalResultStore:
    root: Path

    def path_of(self, object_key: str) -> Path:
        root = self.root.resolve()
        path = (root / object_key).resolve()
        if not path.is_relative_to(root) or path == root:
            raise MissingObjectError(object_key)
        return path

    def get(self, object_key: str) -> bytes:
        try:
            return self.path_of(object_key).read_bytes()
        except (FileNotFoundError, IsADirectoryError) as error:
            raise MissingObjectError(object_key) from error

    def put(self, object_key: str, data: bytes) -> None:
        path = self.path_of(object_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
