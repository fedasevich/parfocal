import json
import uuid
from collections.abc import Iterator

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from test_showcase import RESULTS, EmptyStore

from parfocal_api.gpu_calls import GpuCalls
from parfocal_api.outline_types import (
    OutlinesToType,
    OutlineToType,
    OutlineTypes,
    type_outlines,
)
from parfocal_api.principals import MemberPrincipal
from parfocal_api.result_sets import list_slide_result_sets
from parfocal_api.showcase import VIEWER_SAMPLE, WORKSPACES, seed
from parfocal_api.tables import Role
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.outline_types import outline_types_call_of
from parfocal_common.repository import repository_root
from parfocal_common.warm_gate import WarmGate

pytestmark = pytest.mark.db

SMOKE = "smoke-walk@example.test"
AGENT = "agent-walk@example.test"
NUCLEUS = [42515.0, 24072.0, 42507.0, 24072.0, 42506.0, 24066.0, 42517.0, 24064.0]


class OneClassTyper:
    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        return None

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        shares = {"tumor": 0.1, "stroma": 0.6, "immune": 0.2, "other": 0.1}
        typed: dict[str, object] = {
            "probabilities": shares,
            "type": "stroma",
            "alternatives": [],
            "foreground": 0.9,
        }
        return {"outlines": [typed for _ in outline_types_call_of(call).outlines]}


@pytest.fixture(scope="module")
def seeded() -> Iterator[str]:
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        yield url


async def seed_accounts(url: str) -> None:
    for _ in range(2):
        await seed(
            url,
            EmptyStore(),  # type: ignore[arg-type]
            RESULTS,
            "owner@example.test",
            viewer_emails=[SMOKE],
            agent_emails=[AGENT.upper()],
        )


async def seats_of(url: str, email: str) -> set[tuple[str, str, bool, str]]:
    rows = await run_sql(
        url,
        "SELECT t.slug, m.role, m.admin_rights, pm.role FROM users u "
        "JOIN memberships m ON m.user_id = u.id JOIN tenants t ON t.id = m.tenant_id "
        "JOIN project_members pm ON pm.user_id = u.id JOIN projects p ON p.id = pm.project_id "
        f"WHERE u.email = '{email}' AND p.tenant_id = t.id",
    )
    return {(str(slug), str(role), bool(admin), str(seat)) for slug, role, admin, seat in rows}


async def test_an_agent_email_gets_an_admin_owner_seat_on_every_seeded_project(
    seeded: str,
) -> None:
    await seed_accounts(seeded)
    seats = await seats_of(seeded, AGENT)
    assert {slug for slug, *_ in seats} == {workspace.slug for workspace in WORKSPACES}
    assert {(role, admin, seat) for _, role, admin, seat in seats} == {
        ("researcher", True, "owner")
    }
    held = await run_sql(
        seeded,
        "SELECT t.slug FROM memberships m JOIN users u ON u.id = m.user_id "
        f"JOIN tenants t ON t.id = m.tenant_id WHERE u.email = '{AGENT}'",
    )
    assert sorted(str(row[0]) for row in held) == sorted(w.slug for w in WORKSPACES)


async def test_the_smoke_account_sees_ai_cells_and_types_an_outline_on_the_sample(
    seeded: str,
) -> None:
    await seed_accounts(seeded)
    tenant_id, slide_id, user_id = (
        await run_sql(
            seeded,
            "SELECT s.tenant_id, s.id, u.id FROM slides s "
            "JOIN project_members pm ON pm.project_id = s.project_id "
            "JOIN users u ON u.id = pm.user_id "
            f"WHERE s.label = '{VIEWER_SAMPLE}' AND u.email = '{SMOKE}' LIMIT 1",
        )
    )[0]
    tenant, slide = uuid.UUID(str(tenant_id)), uuid.UUID(str(slide_id))
    principal = MemberPrincipal(
        f"seed:{SMOKE}", tenant, uuid.UUID(str(user_id)), Role.REVIEWER, False
    )
    engine = create_engine(seeded)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=tenant, user_id=principal.user_id)
        ) as connection:
            sets = await list_slide_result_sets(slide, principal, connection)
            assert any(found.cell_count > 0 for found in sets)
            typed = await type_outlines(
                slide,
                OutlinesToType(outlines=[OutlineToType(points=NUCLEUS)]),
                principal,
                connection,
                GpuCalls(WarmGate(OneClassTyper()), None),  # type: ignore[arg-type]
                None,
            )
        assert isinstance(typed, OutlineTypes)
        assert typed.slide_id == slide
        assert [outline.type for outline in typed.outlines] == ["stroma"]
    finally:
        await engine.dispose()


def test_the_agent_session_script_trusts_exactly_the_seeded_workspaces() -> None:
    declared = json.loads(
        (repository_root(__file__, 3) / "infra/app-environments.json").read_text()
    )
    assert sorted(declared["seeded_workspaces"]) == sorted(w.slug for w in WORKSPACES)
