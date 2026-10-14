import uuid
from datetime import UTC, datetime, timedelta

from hypothesis import given
from hypothesis import strategies as st

from parfocal_api.routing import Candidate, CaseToRoute, Routed, choose, queue_order, route
from parfocal_api.tables import Priority

NODES, SKIN = uuid.uuid4(), uuid.uuid4()
T0 = datetime(2026, 10, 14, 8, tzinfo=UTC)


def uid(name: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_DNS, name)


def person(
    name: str,
    folders: frozenset[uuid.UUID] = frozenset(),
    *,
    all_folders: bool = False,
    specimen_types: frozenset[str] | None = None,
    load: int = 0,
    capacity: int = 240,
    available: bool = True,
) -> Candidate:
    return Candidate(uid(name), folders, all_folders, specimen_types, load, capacity, available)


def case(
    name: str,
    priority: Priority = Priority.ROUTINE,
    *,
    folder: uuid.UUID | None = None,
    specimens: frozenset[str] = frozenset(),
    minutes: int = 20,
    at: int = 0,
) -> CaseToRoute:
    return CaseToRoute(uid(name), priority, T0 + timedelta(minutes=at), folder, specimens, minutes)


def chosen(item: CaseToRoute, people: list[Candidate]) -> uuid.UUID | None:
    picked = choose(item, people)
    return picked.user_id if picked else None


def test_only_people_of_the_cases_folder_are_chosen() -> None:
    people = [person("nodes", frozenset({NODES})), person("skin", frozenset({SKIN}))]
    assert chosen(case("a", folder=NODES), people) == uid("nodes")
    assert chosen(case("b", folder=SKIN), people) == uid("skin")


def test_a_lead_with_every_folder_and_unfiled_cases_take_anyone() -> None:
    lead = person("lead", all_folders=True, load=10)
    nodes = person("nodes", frozenset({NODES}), load=100)
    assert chosen(case("a", folder=SKIN), [lead, nodes]) == uid("lead")
    assert chosen(case("b"), [nodes]) == uid("nodes")


def test_specimen_types_must_be_read_by_the_person() -> None:
    breast = person(
        "breast", frozenset({NODES}), specimen_types=frozenset({"breast", "lymph node"})
    )
    skin = person("skinonly", frozenset({NODES}), specimen_types=frozenset({"skin"}))
    anything = person("anything", frozenset({NODES}), load=200)
    item = case("a", folder=NODES, specimens=frozenset({"breast", "lymph node"}))
    assert chosen(item, [breast, skin]) == uid("breast")
    assert chosen(item, [skin]) is None
    assert chosen(item, [skin, anything]) == uid("anything")


def test_the_least_loaded_share_of_capacity_wins() -> None:
    busy = person("busy", load=120, capacity=240)
    light = person("light", load=60, capacity=100)
    lighter = person("lighter", load=30, capacity=100)
    assert chosen(case("a"), [busy, light, lighter]) == uid("lighter")
    assert chosen(case("b"), [busy, light]) == uid("busy")


def test_people_away_or_full_are_skipped_except_for_stat() -> None:
    away = person("away", available=False)
    full = person("full", load=230, capacity=240)
    assert chosen(case("a"), [away, full]) is None
    assert chosen(case("b", Priority.STAT), [away, full]) == uid("full")


def test_stat_goes_first_then_by_priority_and_age() -> None:
    items = [
        case("routine-old", Priority.ROUTINE, at=0),
        case("urgent", Priority.URGENT, at=5),
        case("stat-late", Priority.STAT, at=30),
        case("asap", Priority.ASAP, at=10),
        case("stat-early", Priority.STAT, at=20),
    ]
    assert [item.case_id for item in queue_order(items)] == [
        uid("stat-early"),
        uid("stat-late"),
        uid("asap"),
        uid("urgent"),
        uid("routine-old"),
    ]


def test_the_queue_spreads_cases_and_stat_takes_the_last_room() -> None:
    first = person("first", capacity=40)
    second = person("second", capacity=40)
    items = [case(f"r{n}", at=n) for n in range(4)] + [case("stat", Priority.STAT, at=99)]
    routed = {entry.case_id: entry.user_id for entry in route(items, [first, second])}
    assert routed[uid("stat")] == uid("first")
    assigned = [routed[uid(f"r{n}")] for n in range(4)]
    assert assigned.count(uid("first")) == 1
    assert assigned.count(uid("second")) == 2
    assert assigned.count(None) == 1


def test_nobody_eligible_leaves_the_case_in_the_pool() -> None:
    assert route([case("a", folder=SKIN)], [person("nodes", frozenset({NODES}))]) == [
        Routed(uid("a"), None)
    ]


PEOPLE = st.lists(
    st.builds(
        person,
        st.sampled_from(["p1", "p2", "p3", "p4"]),
        st.frozensets(st.sampled_from([NODES, SKIN])),
        load=st.integers(0, 300),
        capacity=st.integers(1, 300),
        available=st.booleans(),
    ),
    max_size=4,
    unique_by=lambda candidate: candidate.user_id,
)
CASES = st.lists(
    st.builds(
        case,
        st.uuids().map(str),
        st.sampled_from(list(Priority)),
        folder=st.sampled_from([NODES, SKIN, None]),
        minutes=st.integers(1, 60),
        at=st.integers(0, 600),
    ),
    max_size=12,
    unique_by=lambda item: item.case_id,
)


@given(CASES, PEOPLE)
def test_routing_never_breaks_the_rules(items: list[CaseToRoute], people: list[Candidate]) -> None:
    routed = route(items, people)
    assert {entry.case_id for entry in routed} == {item.case_id for item in items}
    by_id = {candidate.user_id: candidate for candidate in people}
    load = {candidate.user_id: candidate.load_minutes for candidate in people}
    for entry, item in zip(routed, queue_order(items), strict=True):
        assert entry.case_id == item.case_id
        if entry.user_id is None:
            continue
        picked = by_id[entry.user_id]
        assert picked.available
        assert picked.works_in(item.folder_id)
        if item.priority is not Priority.STAT:
            assert load[picked.user_id] + item.minutes <= picked.capacity_minutes
        load[picked.user_id] += item.minutes
