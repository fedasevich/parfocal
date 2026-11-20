import asyncio
import uuid
from collections.abc import Iterator

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from test_showcase import RESULTS, EmptyStore

from parfocal_api.my_work import list_my_review_tasks
from parfocal_api.principals import MemberPrincipal
from parfocal_api.review_objects import list_review_objects
from parfocal_api.showcase import CELL_TOUR, CELLS_CHECKED, WORKSPACES, seed
from parfocal_api.tables import Role
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction

pytestmark = pytest.mark.db

OWNER = "owner@example.test"
AGENT = "agent-cells@example.test"
LATER_AGENT = "agent-later@example.test"


def seed_once(url: str, agents: list[str]) -> None:
    asyncio.run(
        seed(
            url,
            EmptyStore(),  # type: ignore[arg-type]
            RESULTS,  # type: ignore[arg-type]
            OWNER,
            agent_emails=agents,
        )
    )


@pytest.fixture(scope="module")
def seeded() -> Iterator[str]:
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        seed_once(url, [AGENT, LATER_AGENT])
        seed_once(url, [AGENT, LATER_AGENT])
        yield url


async def cell_tour_seats(url: str, email: str) -> list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]]:
    rows = await run_sql(
        url,
        "SELECT a.task_id, a.slide_id, u.id FROM review_assignments a "
        "JOIN review_tasks t ON t.id = a.task_id JOIN users u ON u.id = a.user_id "
        "JOIN tenants w ON w.id = t.tenant_id "
        f"WHERE t.name = '{CELL_TOUR}' AND u.email = '{email}' "
        f"AND w.slug = '{WORKSPACES[0].slug}' AND a.released_at IS NULL",
    )
    return [
        (uuid.UUID(str(task)), uuid.UUID(str(slide)), uuid.UUID(str(user)))
        for task, slide, user in rows
    ]


async def test_the_first_agent_reviews_every_slide_of_the_cell_tour_once(seeded: str) -> None:
    seats = await cell_tour_seats(seeded, AGENT)
    slides = await run_sql(
        seeded,
        "SELECT ts.slide_id FROM review_task_slides ts JOIN review_tasks t ON t.id = ts.task_id "
        f"JOIN tenants w ON w.id = t.tenant_id WHERE t.name = '{CELL_TOUR}' "
        f"AND w.slug = '{WORKSPACES[0].slug}'",
    )
    assert slides
    assert sorted(str(slide) for _, slide, _ in seats) == sorted(str(row[0]) for row in slides)
    assert await cell_tour_seats(seeded, LATER_AGENT) == []


async def test_the_first_agent_has_a_cell_sample_to_type_on_the_cell_tour(seeded: str) -> None:
    seats = await cell_tour_seats(seeded, AGENT)
    task_id, _, user_id = seats[0]
    tenant_id = uuid.UUID(
        str(
            (await run_sql(seeded, f"SELECT tenant_id FROM review_tasks WHERE id = '{task_id}'"))[
                0
            ][0]
        )
    )
    principal = MemberPrincipal(f"seed:{AGENT}", tenant_id, user_id, Role.RESEARCHER, True)
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=tenant_id, user_id=user_id)
        ) as connection:
            mine = await list_my_review_tasks(principal, connection)
            assert task_id in {task.id for task in mine}
            for _, slide_id, _ in seats:
                listed = await list_review_objects(
                    task_id,
                    slide_id,
                    principal,
                    connection,
                    RESULTS,  # type: ignore[arg-type]
                )
                assert len(listed.objects) == CELLS_CHECKED
                assert {item.kind for item in listed.objects} == {"cell"}
    finally:
        await engine.dispose()
