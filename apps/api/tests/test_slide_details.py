import asyncio
import uuid
from collections.abc import Awaitable, Callable

import pytest
from case_support import SeededCase, seed_case, seed_project
from db_support import APP_URL, ApiAs, with_database
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from workspace_support import join_project, make_tenant, owner, person

from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.tables import PrivacyMode, Role
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

pytestmark = pytest.mark.db


def run[T](
    database: str, tenant_id: uuid.UUID, work: Callable[[AsyncConnection], Awaitable[T]]
) -> T:
    async def go() -> T:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
                return await work(connection)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def seeded(database: str, tenant_id: uuid.UUID) -> SeededCase:
    return run(database, tenant_id, lambda connection: seed_case(connection, tenant_id))


def project_person(
    database: str,
    case: SeededCase,
    tenant_id: uuid.UUID,
    project_role: str,
    role: Role = Role.RESEARCHER,
) -> MemberPrincipal:
    who = person(database, tenant_id, f"{project_role}-{uuid.uuid4().hex[:6]}", role)
    join_project(database, case.project_id, who, project_role)
    return who


def audit_of(database: str, target: object) -> list[tuple[object, ...]]:
    return owner(
        database,
        f"SELECT action, details FROM audit_events WHERE target_id = '{target}' "
        "AND action IN ('slide.details-changed', 'case.slides-reordered') ORDER BY occurred_at",
    )


def test_an_owner_changes_stain_block_level_and_label(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    slide = case.slide_ids[1]
    response = api(who).patch(
        f"/api/slides/{slide}",
        json={"stain": "PAS", "block_id": str(case.block_ids[1]), "level": 3, "label": "B1-3"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["stain"], body["block_id"], body["level"], body["label"]) == (
        "PAS",
        str(case.block_ids[1]),
        3,
        "B1-3",
    )
    detail = api(who).get(f"/api/cases/{case.case_id}").json()
    assert [(s["label"], s["stain"], s["level"]) for s in detail["slides"]] == [
        ("A1", "H&E", None),
        ("B1-3", "PAS", 3),
    ]
    assert audit_of(database, slide) == [
        ("slide.details-changed", '{"fields":["block_id","label","level","stain"]}')
    ]


def test_omitted_fields_stay_and_null_clears_block_and_level(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    slide = case.slide_ids[0]
    api(who).patch(f"/api/slides/{slide}", json={"level": 4})
    response = api(who).patch(f"/api/slides/{slide}", json={"block_id": None, "level": None})
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["label"], body["stain"], body["block_id"], body["level"]) == (
        "A1",
        "H&E",
        None,
        None,
    )


def test_an_unchanged_edit_writes_no_audit_entry(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    response = api(who).patch(f"/api/slides/{case.slide_ids[0]}", json={"stain": "H&E"})
    assert response.status_code == 200, response.text
    assert audit_of(database, case.slide_ids[0]) == []


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"stain": ""}, 422),
        ({"stain": None}, 422),
        ({"label": None}, 422),
        ({"level": 0}, 422),
        ({"level": 51}, 422),
        ({"barcode": "X"}, 422),
        ({"label": "A2"}, 409),
    ],
)
def test_bad_edits_are_refused(
    api: ApiAs, database: str, body: dict[str, object], status: int
) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    response = api(who).patch(f"/api/slides/{case.slide_ids[0]}", json=body)
    assert response.status_code == status, response.text


def test_a_block_from_another_case_is_refused(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    other = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    join_project(database, other.project_id, who, "owner")
    response = api(who).patch(
        f"/api/slides/{case.slide_ids[0]}", json={"block_id": str(other.block_ids[0])}
    )
    assert response.status_code == 400
    assert response.json()["code"] == "block-outside-case"
    loose = api(who).patch(
        f"/api/slides/{case.loose_slide_id}", json={"block_id": str(case.block_ids[0])}
    )
    assert loose.status_code == 400


def test_viewers_and_reviewers_change_nothing(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    viewer = project_person(database, case, tenant, "viewer")
    reviewer = project_person(database, case, tenant, "reviewer", Role.REVIEWER)
    for who in (viewer, reviewer):
        assert (
            api(who).patch(f"/api/slides/{case.slide_ids[0]}", json={"stain": "PAS"}).status_code
            == 403
        )
        assert (
            api(who)
            .put(f"/api/cases/{case.case_id}/slide-order", json={"slide_ids": []})
            .status_code
            == 403
        )
    stranger = person(database, tenant, "stranger", Role.RESEARCHER)
    assert (
        api(stranger).patch(f"/api/slides/{case.slide_ids[0]}", json={"stain": "PAS"}).status_code
        == 404
    )


def test_label_text_in_a_clinical_project_needs_the_label_permission(
    api: ApiAs, database: str
) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    service: Principal = ServicePrincipal(uuid.uuid4(), tenant, frozenset({"create-cases"}))
    refused = api(service).patch(f"/api/slides/{case.slide_ids[0]}", json={"label": "A1-new"})
    assert refused.status_code == 403
    assert refused.json()["code"] == "slide-label-hidden"
    allowed = api(service).patch(f"/api/slides/{case.slide_ids[0]}", json={"stain": "CK"})
    assert allowed.status_code == 200, allowed.text
    labels = ServicePrincipal(uuid.uuid4(), tenant, frozenset({"create-cases", "see-labels"}))
    assert (
        api(labels).patch(f"/api/slides/{case.slide_ids[0]}", json={"label": "A1-new"}).status_code
        == 200
    )


def test_label_text_in_a_de_identified_project_needs_only_ownership(
    api: ApiAs, database: str
) -> None:
    tenant = make_tenant(database)
    project = run(
        database,
        tenant,
        lambda connection: seed_project(connection, tenant, PrivacyMode.DE_IDENTIFIED),
    )
    slide = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO slides (tenant_id, project_id, label) "
                f"VALUES ('{tenant}', '{project}', 'tcga-1') RETURNING id",
            )[0][0]
        )
    )
    service = ServicePrincipal(uuid.uuid4(), tenant, frozenset({"create-cases"}))
    response = api(service).patch(f"/api/slides/{slide}", json={"label": "tcga-2"})
    assert response.status_code == 200, response.text


def test_an_owner_reorders_the_slides_of_a_case(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    first, second = case.slide_ids
    response = api(who).put(
        f"/api/cases/{case.case_id}/slide-order", json={"slide_ids": [str(second), str(first)]}
    )
    assert response.status_code == 200, response.text
    assert [s["label"] for s in response.json()["slides"]] == ["A2", "A1"]
    assert [s["label"] for s in api(who).get(f"/api/cases/{case.case_id}").json()["slides"]] == [
        "A2",
        "A1",
    ]
    partial = api(who).put(
        f"/api/cases/{case.case_id}/slide-order", json={"slide_ids": [str(first)]}
    )
    assert [s["label"] for s in partial.json()["slides"]] == ["A1", "A2"]
    assert audit_of(database, case.case_id) == [
        ("case.slides-reordered", '{"moved":2,"slides":2}'),
        ("case.slides-reordered", '{"moved":2,"slides":2}'),
    ]


@pytest.mark.parametrize("which", ["loose", "repeated", "unknown"])
def test_an_order_with_slides_outside_the_case_is_refused(
    api: ApiAs, database: str, which: str
) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    who = project_person(database, case, tenant, "owner")
    ids = {
        "loose": [case.slide_ids[0], case.loose_slide_id],
        "repeated": [case.slide_ids[0], case.slide_ids[0]],
        "unknown": [uuid.uuid4()],
    }[which]
    response = api(who).put(
        f"/api/cases/{case.case_id}/slide-order", json={"slide_ids": [str(i) for i in ids]}
    )
    assert response.status_code == 400
    assert response.json()["code"] == "slide-outside-case"


def test_another_workspace_neither_edits_nor_reorders(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case = seeded(database, tenant)
    elsewhere = make_tenant(database)
    outsider = person(database, elsewhere, "outsider", Role.RESEARCHER)
    assert (
        api(outsider).patch(f"/api/slides/{case.slide_ids[0]}", json={"stain": "PAS"}).status_code
        == 404
    )
    assert (
        api(outsider)
        .put(f"/api/cases/{case.case_id}/slide-order", json={"slide_ids": []})
        .status_code
        == 404
    )
