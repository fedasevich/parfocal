import time
from collections.abc import Mapping
from typing import Any

ALLOCATE_MIB = 512
PAGE = 4096


def allocate(_arguments: Mapping[str, Any], _storage: object) -> dict[str, Any]:
    block = bytearray(ALLOCATE_MIB * 1024 * 1024)
    for index in range(0, len(block), PAGE):
        block[index] = 1
    return {"allocated": len(block)}


def linger(arguments: Mapping[str, Any], _storage: object) -> dict[str, Any]:
    time.sleep(float(arguments["seconds"]))
    return {"lingered": True}
