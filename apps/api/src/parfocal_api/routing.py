import uuid
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import datetime

from parfocal_api.tables import Priority

PRIORITY_ORDER = {Priority.STAT: 0, Priority.ASAP: 1, Priority.URGENT: 2, Priority.ROUTINE: 3}
DEFAULT_CASE_MINUTES = 20


@dataclass(frozen=True)
class Candidate:
    user_id: uuid.UUID
    folders: frozenset[uuid.UUID]
    all_folders: bool = False
    specimen_types: frozenset[str] | None = None
    load_minutes: int = 0
    capacity_minutes: int = 240
    available: bool = True

    def works_in(self, folder_id: uuid.UUID | None) -> bool:
        return folder_id is None or self.all_folders or folder_id in self.folders

    def reads(self, specimen_types: frozenset[str]) -> bool:
        return self.specimen_types is None or specimen_types <= self.specimen_types

    def has_room(self, minutes: int) -> bool:
        return self.load_minutes + minutes <= self.capacity_minutes

    @property
    def load_share(self) -> float:
        return self.load_minutes / self.capacity_minutes if self.capacity_minutes else 1.0


@dataclass(frozen=True)
class CaseToRoute:
    case_id: uuid.UUID
    priority: Priority
    created_at: datetime
    folder_id: uuid.UUID | None = None
    specimen_types: frozenset[str] = frozenset()
    minutes: int = DEFAULT_CASE_MINUTES


@dataclass(frozen=True)
class Routed:
    case_id: uuid.UUID
    user_id: uuid.UUID | None


def eligible(case: CaseToRoute, candidates: Iterable[Candidate]) -> list[Candidate]:
    return [
        candidate
        for candidate in candidates
        if candidate.available
        and candidate.works_in(case.folder_id)
        and candidate.reads(case.specimen_types)
        and (case.priority is Priority.STAT or candidate.has_room(case.minutes))
    ]


def choose(case: CaseToRoute, candidates: Iterable[Candidate]) -> Candidate | None:
    options = eligible(case, candidates)
    if not options:
        return None
    return min(options, key=lambda candidate: (candidate.load_share, str(candidate.user_id)))


def queue_order(cases: Iterable[CaseToRoute]) -> list[CaseToRoute]:
    return sorted(
        cases, key=lambda case: (PRIORITY_ORDER[case.priority], case.created_at, str(case.case_id))
    )


def route(cases: Iterable[CaseToRoute], candidates: Iterable[Candidate]) -> list[Routed]:
    people = {candidate.user_id: candidate for candidate in candidates}
    routed: list[Routed] = []
    for case in queue_order(cases):
        chosen = choose(case, people.values())
        if chosen is None:
            routed.append(Routed(case.case_id, None))
            continue
        people[chosen.user_id] = replace(chosen, load_minutes=chosen.load_minutes + case.minutes)
        routed.append(Routed(case.case_id, chosen.user_id))
    return routed
