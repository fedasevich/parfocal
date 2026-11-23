import asyncio
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from db_support import OWNER_URL, migrated_database, query, with_database
from sqlalchemy import event
from sqlalchemy.engine import Engine
from test_showcase import EmptyStore, MemoryResults, PublishedStore

from parfocal_api.disagreements import queue_of
from parfocal_api.showcase import PEOPLE
from parfocal_api.study_projects import (
    ANNOTATE_SLIDE,
    ANNOTATE_TASK,
    CELL_SLIDE,
    CELL_TASK,
    CELLS_CHECKED,
    ORDER_SEED,
    PROJECT_PREFIX,
    QUEUE_SLIDES,
    QUEUE_TASK,
    REVIEW_SLIDES,
    REVIEW_TASK,
    BadParticipantCodeError,
    StudyProject,
    remove_participant,
    seat_subject,
    seed_participant,
)
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.repository import repository_root

pytestmark = pytest.mark.db

STATEMENT_CEILING = 450
LOCAL_SECONDS_CEILING = 10.0


@dataclass
class Seeded:
    url: str
    made: dict[str, StudyProject] = field(default_factory=dict)
    before: dict[str, Any] = field(default_factory=dict)
    statements: dict[str, int] = field(default_factory=dict)
    seconds: dict[str, float] = field(default_factory=dict)


def keys_of(url: str, made: StudyProject) -> dict[str, str]:
    rows = query(url, "SELECT id, subject FROM users")
    by_subject = {person.subject: person.key for person in PEOPLE}
    keys = {str(user_id): by_subject.get(str(subject), "other") for user_id, subject in rows}
    keys[str(made.seat_id)] = "seat"
    return keys


def snapshot(url: str, made: StudyProject) -> dict[str, Any]:
    keys = keys_of(url, made)
    project = f"'{made.project_id}'"
    slides = query(
        url,
        "SELECT s.label, count(o.number) FROM slides s "
        "LEFT JOIN result_sets r ON r.slide_id = s.id "
        "LEFT JOIN result_objects o ON o.result_set_id = r.id "
        f"WHERE s.project_id = {project} GROUP BY s.label ORDER BY s.label",
    )
    tasks = query(
        url,
        f"SELECT name, kind FROM review_tasks WHERE project_id = {project} ORDER BY name",
    )
    members = sorted(
        (keys[str(user_id)], str(role))
        for user_id, role in query(
            url, f"SELECT user_id, role FROM project_members WHERE project_id = {project}"
        )
    )
    assignments = sorted(
        (str(name), str(label), keys[str(user_id)], submitted)
        for name, label, user_id, submitted in query(
            url,
            "SELECT t.name, s.label, a.user_id, a.submitted_at IS NOT NULL "
            "FROM review_assignments a JOIN review_tasks t ON t.id = a.task_id "
            f"JOIN slides s ON s.id = a.slide_id WHERE t.project_id = {project}",
        )
    )
    decisions = sorted(
        (str(name), str(label), keys[str(user_id)], int(str(number)), str(value))
        for name, label, user_id, number, value in query(
            url,
            "SELECT t.name, s.label, d.user_id, d.number, d.value "
            "FROM review_decisions d JOIN review_tasks t ON t.id = d.task_id "
            f"JOIN slides s ON s.id = d.slide_id WHERE t.project_id = {project}",
        )
    )
    edits = query(
        url,
        "SELECT count(*) FROM review_edits e JOIN review_tasks t ON t.id = e.task_id "
        f"WHERE t.project_id = {project}",
    )
    labels = {
        str(slide_id): str(label) for slide_id, label in query(url, "SELECT id, label FROM slides")
    }
    return {
        "slides": slides,
        "tasks": tasks,
        "members": members,
        "assignments": assignments,
        "decisions": decisions,
        "edits": edits,
        "order": query(
            url,
            "SELECT o.seed, o.count, t.scope_seed FROM review_order o "
            "JOIN review_tasks t ON t.id = o.task_id "
            f"WHERE t.project_id = {project}",
        ),
        "queue": asyncio.run(queued(url, made, labels)),
    }


async def queued(
    url: str, made: StudyProject, labels: dict[str, str]
) -> list[tuple[str, int, str]]:
    engine = create_engine(url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=made.tenant_id)
        ) as connection:
            items = await queue_of(connection, made.queue_task_id)
    finally:
        await engine.dispose()
    return sorted((labels[str(item.slide_id)], item.number, item.why.value) for item in items)


def seeded_one(seeded: Seeded, code: str, store: EmptyStore | None = None) -> StudyProject:
    counted = [0]

    def executed(*_: Any) -> None:
        counted[0] += 1

    event.listen(Engine, "before_cursor_execute", executed)
    started = time.monotonic()
    try:
        made = asyncio.run(
            seed_participant(
                seeded.url,
                store or EmptyStore(),  # type: ignore[arg-type]
                MemoryResults(),
                code,
            )
        )
    finally:
        event.remove(Engine, "before_cursor_execute", executed)
    seeded.statements[made.code] = counted[0]
    seeded.seconds[made.code] = time.monotonic() - started
    seeded.made[made.code] = made
    return made


@pytest.fixture(scope="module")
def seeded() -> Iterator[Seeded]:
    with migrated_database() as name:
        found = Seeded(with_database(OWNER_URL, name))
        first = seeded_one(found, "P1")
        found.before["P1"] = snapshot(found.url, first)
        seeded_one(found, "p2")
        yield found


def test_two_participant_projects_start_from_the_same_state(seeded: Seeded) -> None:
    first, second = seeded.made["P1"], seeded.made["P2"]
    assert first.project_id != second.project_id
    assert first.seat_id != second.seat_id
    assert snapshot(seeded.url, first) == snapshot(seeded.url, second)


def test_seeding_a_second_participant_leaves_the_first_untouched(seeded: Seeded) -> None:
    assert snapshot(seeded.url, seeded.made["P1"]) == seeded.before["P1"]


def test_a_participant_project_holds_a_review_a_queue_and_an_annotate_slide(
    seeded: Seeded,
) -> None:
    state = seeded.before["P1"]
    assert [label for label, _ in state["slides"]] == sorted(
        [*REVIEW_SLIDES, *QUEUE_SLIDES, ANNOTATE_SLIDE, CELL_SLIDE]
    )
    assert all(
        regions > 0
        for label, regions in state["slides"]
        if label not in {ANNOTATE_SLIDE, CELL_SLIDE}
    )
    assert [name for name, _ in state["tasks"]] == sorted(
        [REVIEW_TASK, QUEUE_TASK, ANNOTATE_TASK, CELL_TASK]
    )
    assert (ORDER_SEED, CELLS_CHECKED, ORDER_SEED) in state["order"]
    assert {seed for seed, *_ in state["order"]} == {ORDER_SEED}
    seat_work = {(name, label) for name, label, key, _ in state["assignments"] if key == "seat"}
    assert seat_work == {
        *((REVIEW_TASK, label) for label in REVIEW_SLIDES),
        (ANNOTATE_TASK, ANNOTATE_SLIDE),
        (CELL_TASK, CELL_SLIDE),
    }
    assert not any(key == "seat" for _, _, key, *_ in state["decisions"])
    assert state["queue"]
    assert {why for *_, why in state["queue"]} >= {"outlines-differ"}


def test_the_seeded_ids_point_inside_the_participant_project(seeded: Seeded) -> None:
    made = seeded.made["P2"]
    project = str(made.project_id)
    for task_id in (
        made.review_task_id,
        made.queue_task_id,
        made.annotate_task_id,
        made.cell_task_id,
    ):
        [(owner,)] = query(
            seeded.url, f"SELECT project_id FROM review_tasks WHERE id = '{task_id}'"
        )
        assert str(owner) == project
    for slide_id in (
        made.review_slide_id,
        made.queue_slide_id,
        made.annotate_slide_id,
        made.cell_slide_id,
    ):
        [(owner,)] = query(seeded.url, f"SELECT project_id FROM slides WHERE id = '{slide_id}'")
        assert str(owner) == project
    [(name,)] = query(seeded.url, f"SELECT name FROM projects WHERE id = '{project}'")
    assert name == f"{PROJECT_PREFIX}P2"


def test_a_participant_seed_stays_small_and_quick(seeded: Seeded) -> None:
    assert 0 < seeded.statements["P2"] <= STATEMENT_CEILING
    assert seeded.seconds["P2"] < LOCAL_SECONDS_CEILING


def test_reseeding_a_code_replaces_its_project_and_removing_it_hides_it(seeded: Seeded) -> None:
    old = seeded.made["P2"]
    again = seeded_one(seeded, "P2")
    assert again.project_id != old.project_id
    live = query(
        seeded.url,
        f"SELECT id FROM projects WHERE name = '{PROJECT_PREFIX}P2' AND deleted_at IS NULL",
    )
    assert [str(row[0]) for row in live] == [str(again.project_id)]
    assert asyncio.run(remove_participant(seeded.url, "P2")) == 1
    assert not query(
        seeded.url,
        f"SELECT id FROM projects WHERE name = '{PROJECT_PREFIX}P2' AND deleted_at IS NULL",
    )
    assert asyncio.run(remove_participant(seeded.url, "P2")) == 0


def test_a_participant_code_is_short_and_plain() -> None:
    with pytest.raises(BadParticipantCodeError):
        seat_subject("P1'; drop")
    assert seat_subject("p1").endswith("study-p1@showcase.invalid")


def test_a_full_sample_pool_still_seeds_an_outline_disagreement(seeded: Seeded) -> None:
    made = seeded_one(seeded, "P9", PublishedStore())
    state = snapshot(seeded.url, made)
    assert "outlines-differ" in {why for *_, why in state["queue"]}
    assert asyncio.run(remove_participant(seeded.url, "P9")) == 1


def test_the_web_finds_the_seeded_names() -> None:
    source = (
        repository_root(__file__, 3) / "apps/web/src/study/participant-project.ts"
    ).read_text()
    assert f'studyProjectPrefix = "{PROJECT_PREFIX}"' in source
    for name in (REVIEW_TASK, QUEUE_TASK, ANNOTATE_TASK, CELL_TASK):
        assert re.search(rf': "{re.escape(name)}",', source), name
    for label in (REVIEW_SLIDES[0], QUEUE_SLIDES[0], ANNOTATE_SLIDE, CELL_SLIDE):
        assert re.search(rf': "{re.escape(label)}",', source), label
