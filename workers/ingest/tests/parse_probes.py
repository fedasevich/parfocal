import os
import socket
import subprocess
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from parfocal_common.ingest import Refusal
from parfocal_common.jobs import StepFailedError
from parfocal_ingest.isolated_child import ScopedStorage

CHUNK_BYTES = 16 * 1024 * 1024


def outcome_of(action: Any) -> str:
    try:
        action()
    except OSError as error:
        return type(error).__name__
    return "allowed"


def reach_network(arguments: Mapping[str, Any], _storage: ScopedStorage) -> dict[str, Any]:
    port = int(arguments["port"])
    return {
        "connect": outcome_of(lambda: socket.create_connection(("127.0.0.1", port), timeout=2)),
        "resolve": outcome_of(lambda: socket.getaddrinfo("example.com", 443)),
        "spawn": outcome_of(lambda: subprocess.run(["/bin/echo", "hi"], check=False)),
    }


def environment(_arguments: Mapping[str, Any], _storage: ScopedStorage) -> dict[str, Any]:
    return {"names": sorted(os.environ)}


def read_keys(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    found: dict[str, str] = {}
    for key in arguments["keys"]:
        try:
            found[key] = storage.fetch(key).read_text()
        except PermissionError:
            found[key] = "refused"
    return found


def hog_memory(arguments: Mapping[str, Any], _storage: ScopedStorage) -> dict[str, Any]:
    held: list[bytes] = []
    for _ in range(int(arguments["chunks"])):
        held.append(b"\x01" * CHUNK_BYTES)
        time.sleep(0.05)
    return {"held": len(held)}


def stall(arguments: Mapping[str, Any], _storage: ScopedStorage) -> dict[str, Any]:
    time.sleep(float(arguments["seconds"]))
    return {"slept": True}


def refuse(_arguments: Mapping[str, Any], _storage: ScopedStorage) -> dict[str, Any]:
    raise StepFailedError(Refusal.DAMAGED_TIFF)


def crash(_arguments: Mapping[str, Any], _storage: ScopedStorage) -> dict[str, Any]:
    os._exit(3)


def worker_environment(arguments: Mapping[str, Any], _storage: ScopedStorage) -> dict[str, Any]:
    try:
        with Path(f"/proc/{os.getppid()}/environ").open("rb") as handle:
            return {"read": arguments["sentinel"].encode() in handle.read()}
    except OSError as error:
        return {"read": type(error).__name__}
