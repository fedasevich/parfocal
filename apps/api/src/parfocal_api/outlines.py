import json
from typing import Any


def outline_of(shape: str | None) -> list[float] | None:
    if not shape:
        return None
    geometry: dict[str, Any] = json.loads(shape)
    rings: list[Any] = geometry.get("coordinates") or []
    if geometry.get("type") == "MultiPolygon":
        rings = rings[0] if rings else []
    ring: list[list[float]] = rings[0] if rings else []
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(ring) < 3:
        return None
    return [float(value) for point in ring for value in point[:2]]
