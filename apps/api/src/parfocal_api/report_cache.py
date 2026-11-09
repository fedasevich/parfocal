import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import cast


@dataclass(frozen=True)
class ReportKey:
    tenant_id: uuid.UUID
    task_id: uuid.UUID
    checksum: str
    locale: str
    viewer: uuid.UUID | None
    source: str
    form: str


class ReportCache:
    def __init__(self, entries: int, total_bytes: int) -> None:
        self.entries = entries
        self.total_bytes = total_bytes
        self.held: OrderedDict[ReportKey, tuple[object, int]] = OrderedDict()

    def size(self) -> int:
        return sum(weight for _, weight in self.held.values())

    def kept[T](self, key: ReportKey, make: Callable[[], T], weigh: Callable[[T], int]) -> T:
        found = self.held.get(key)
        if found is not None:
            self.held.move_to_end(key)
            return cast(T, found[0])
        made = make()
        weight = weigh(made)
        if weight > self.total_bytes:
            return made
        self.held[key] = (made, weight)
        while len(self.held) > self.entries or self.size() > self.total_bytes:
            self.held.popitem(last=False)
        return made

    def clear(self) -> None:
        self.held.clear()
