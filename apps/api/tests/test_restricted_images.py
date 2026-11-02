import asyncio
import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx2
import pytest
from db_support import ApiAs, api_as
from storage_support import (
    TEST_STORAGE,
    put_restricted_images,
    stand_in_images,
    stored_keys,
)
from test_annotations import make_class
from test_blinding import make_result_set
from workspace_support import join_project, make_project, make_slide, make_workspace, owner

from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.tables import Role
from parfocal_common.ingest import RestrictedImage, restricted_prefix
from parfocal_common.object_store import ObjectStore, StorageLocation

pytestmark = pytest.mark.db

CLINICAL = "clinical"
DE_IDENTIFIED = "de-identified"
MODES = (CLINICAL, DE_IDENTIFIED)
PROJECT_ROLES = {
    "owner": "owner",
    "viewer": "viewer",
    "reader": "viewer",
    "assigned": "reviewer",
    "unassigned": "reviewer",
}
WORKSPACE_ROLES = {
    "owner": Role.RESEARCHER,
    "viewer": Role.RESEARCHER,
    "reader": Role.REVIEWER,
    "assigned": Role.REVIEWER,
    "unassigned": Role.REVIEWER,
    "admin": Role.RESEARCHER,
    "emergency": Role.RESEARCHER,
}
SHOWN = (200, None)
HIDDEN = (404, "restricted-image-not-found")
NO_SLIDE = (404, "not-found")
EXPECTED: dict[tuple[str, str], tuple[int, str | None]] = {
    ("owner", CLINICAL): SHOWN,
    ("viewer", CLINICAL): SHOWN,
    ("reader", CLINICAL): SHOWN,
    ("emergency", CLINICAL): SHOWN,
    ("assigned", CLINICAL): SHOWN,
    ("unassigned", CLINICAL): NO_SLIDE,
    ("admin", CLINICAL): (403, "emergency-access-needed"),
    ("outsider", CLINICAL): NO_SLIDE,
    ("owner", DE_IDENTIFIED): HIDDEN,
    ("viewer", DE_IDENTIFIED): HIDDEN,
    ("reader", DE_IDENTIFIED): HIDDEN,
    ("emergency", DE_IDENTIFIED): NO_SLIDE,
    ("assigned", DE_IDENTIFIED): HIDDEN,
    ("unassigned", DE_IDENTIFIED): NO_SLIDE,
    ("admin", DE_IDENTIFIED): NO_SLIDE,
    ("outsider", DE_IDENTIFIED): NO_SLIDE,
}


@dataclass(frozen=True)
class Lab:
    tenant_id: uuid.UUID
    people: dict[str, MemberPrincipal]
    projects: dict[str, uuid.UUID]
    cases: dict[str, str]
    slides: dict[str, uuid.UUID]
    patient: str

    def path(self, mode: str, image: str = "label") -> str:
        return f"/api/slides/{self.slides[mode]}/restricted-images/{image}"


def ok(response: Any) -> Any:
    assert 200 <= response.status_code < 300, response.text
    return response


def store_images(tenant_id: uuid.UUID, slide_id: uuid.UUID, images: list[RestrictedImage]) -> None:
    async def put() -> None:
        async with httpx2.AsyncClient(timeout=30) as http:
            stand_ins = stand_in_images(str(slide_id))
            await put_restricted_images(
                ObjectStore(TEST_STORAGE, http),
                tenant_id,
                slide_id,
                {image: stand_ins[image] for image in images},
            )

    asyncio.run(put())


def give_images(
    database: str, tenant_id: uuid.UUID, slide_id: uuid.UUID, images: list[RestrictedImage]
) -> None:
    store_images(tenant_id, slide_id, images)
    kinds = ",".join(image.value for image in images)
    owner(database, f"UPDATE slides SET restricted_images = '{{{kinds}}}' WHERE id = '{slide_id}'")


def case_with_slide(
    api: ApiAs, database: str, lab_owner: MemberPrincipal, project: uuid.UUID, patient: bool
) -> tuple[str, uuid.UUID, str | None]:
    body: dict[str, Any] = {"project_id": str(project), "label": f"S-{uuid.uuid4().hex[:6]}"}
    if patient:
        body["patient"] = {"name": "Jana Nováková"}
    created = ok(api(lab_owner).post("/api/cases", json=body)).json()
    slide = make_slide(
        database, lab_owner.tenant_id, project, "A1", case_id=uuid.UUID(created["id"])
    )
    found = created["patient"]["id"] if created["patient"] else None
    return created["id"], slide, found


def assign(
    api: ApiAs,
    database: str,
    lab_owner: MemberPrincipal,
    project: uuid.UUID,
    slide: uuid.UUID,
    reviewer: MemberPrincipal,
) -> None:
    make_class(database, lab_owner.tenant_id, project)
    result_set = make_result_set(database, lab_owner.tenant_id, project, slide)
    ok(
        api(lab_owner).post(
            f"/api/projects/{project}/review-tasks",
            json={
                "name": "Label task",
                "slide_ids": [str(slide)],
                "result_sets": [{"slide_id": str(slide), "result_set_id": result_set}],
                "reviewer_ids": [str(reviewer.user_id)],
                "split": "everyone",
                "scope": {"kind": "all-regions"},
            },
        )
    )


def build(api: ApiAs, database: str) -> Lab:
    workspace = make_workspace(database, WORKSPACE_ROLES, admins={"admin"})
    people = dict(workspace.people)
    people["outsider"] = make_workspace(database, {"outsider": Role.RESEARCHER}).people["outsider"]
    projects: dict[str, uuid.UUID] = {}
    cases: dict[str, str] = {}
    slides: dict[str, uuid.UUID] = {}
    patient = ""
    for mode in MODES:
        project = make_project(database, workspace.tenant_id, mode)
        for who, role in PROJECT_ROLES.items():
            join_project(database, project, people[who], role)
        case, slide, found = case_with_slide(
            api, database, people["owner"], project, mode == CLINICAL
        )
        give_images(database, workspace.tenant_id, slide, list(RestrictedImage))
        assign(api, database, people["owner"], project, slide, people["assigned"])
        projects[mode], cases[mode], slides[mode] = project, case, slide
        patient = found or patient
    ok(
        api(people["emergency"]).post(
            f"/api/projects/{projects[CLINICAL]}/emergency-access",
            json={"reason": "Checking a label for the study"},
        )
    )
    return Lab(workspace.tenant_id, people, projects, cases, slides, patient)


@pytest.fixture(scope="module")
def lab(database: str, storage: StorageLocation) -> Iterator[Lab]:
    assert storage.bucket
    with api_as(database) as api:
        yield build(api, database)


def viewed(database: str, lab: Lab) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT target_type, target_id, details FROM audit_events "
        f"WHERE tenant_id = '{lab.tenant_id}' AND action = 'slide.restricted-image-viewed' "
        "ORDER BY seq",
    )


def problem_of(response: Any) -> tuple[int, str | None]:
    if response.status_code == 200:
        return 200, None
    return response.status_code, response.json()["code"]


@pytest.mark.parametrize("image", list(RestrictedImage))
@pytest.mark.parametrize(("who", "mode"), sorted(EXPECTED))
def test_each_role_sees_labels_and_macros_only_in_clinical_projects_on_slides_it_reads(
    api: ApiAs, database: str, lab: Lab, who: str, mode: str, image: RestrictedImage
) -> None:
    before = len(viewed(database, lab))
    response = api(lab.people[who]).get(lab.path(mode, image.value))
    assert problem_of(response) == EXPECTED[(who, mode)], response.text
    after = viewed(database, lab)
    if response.status_code == 200:
        assert response.content == stand_in_images(str(lab.slides[mode]))[image]
        assert response.headers["content-type"] == (
            "image/png" if image is RestrictedImage.LABEL else "image/jpeg"
        )
        assert response.headers["cache-control"] == "private, no-store"
        assert after[before:] == [
            ("slide", lab.slides[mode], json.dumps({"image": image.value}, separators=(",", ":")))
        ]
    else:
        assert len(after) == before
        assert b"label of" not in response.content
        assert b"macro of" not in response.content


def test_a_service_account_never_reads_labels(api: ApiAs, lab: Lab) -> None:
    service: Principal = ServicePrincipal(uuid.uuid4(), lab.tenant_id, frozenset({"see-slides"}))
    response = api(service).get(lab.path(CLINICAL))
    assert problem_of(response) == (403, "forbidden")


@pytest.mark.parametrize(
    ("who", "mode", "listed"),
    [
        ("owner", CLINICAL, ["label", "macro"]),
        ("viewer", CLINICAL, ["label", "macro"]),
        ("reader", CLINICAL, ["label", "macro"]),
        ("emergency", CLINICAL, ["label", "macro"]),
        ("assigned", CLINICAL, ["label", "macro"]),
        ("owner", DE_IDENTIFIED, []),
        ("assigned", DE_IDENTIFIED, []),
    ],
)
def test_the_case_lists_only_the_images_the_caller_may_open(
    api: ApiAs, lab: Lab, who: str, mode: str, listed: list[str]
) -> None:
    case = ok(api(lab.people[who]).get(f"/api/cases/{lab.cases[mode]}")).json()
    assert [slide["restricted_images"] for slide in case["slides"]] == [listed]


def test_a_missing_or_deleted_image_is_not_found(api: ApiAs, database: str, lab: Lab) -> None:
    lead = lab.people["owner"]
    project = lab.projects[CLINICAL]
    only_macro = make_slide(database, lab.tenant_id, project, f"Macro {uuid.uuid4().hex[:6]}")
    give_images(database, lab.tenant_id, only_macro, [RestrictedImage.MACRO])
    base = f"/api/slides/{only_macro}/restricted-images"
    assert problem_of(api(lead).get(f"{base}/label")) == HIDDEN
    assert problem_of(api(lead).get(f"{base}/macro")) == SHOWN
    assert api(lead).get(f"{base}/barcode").status_code == 422

    listed_only = make_slide(database, lab.tenant_id, project, f"Gone {uuid.uuid4().hex[:6]}")
    owner(
        database,
        f"UPDATE slides SET restricted_images = '{{label}}' WHERE id = '{listed_only}'",
    )
    assert problem_of(api(lead).get(f"/api/slides/{listed_only}/restricted-images/label")) == (
        HIDDEN
    )

    owner(database, f"UPDATE slides SET deleted_at = now() WHERE id = '{only_macro}'")
    assert problem_of(api(lead).get(f"{base}/macro")) == NO_SLIDE
    assert problem_of(api(lead).get(f"/api/slides/{uuid.uuid4()}/restricted-images/label")) == (
        NO_SLIDE
    )


def test_a_label_read_shows_in_the_patients_audit_trail(api: ApiAs, lab: Lab) -> None:
    ok(api(lab.people["viewer"]).get(lab.path(CLINICAL, "macro")))
    events = ok(
        api(lab.people["admin"]).get("/api/tenant/audit-events", params={"patient_id": lab.patient})
    ).json()
    reads = [event for event in events if event["action"] == "slide.restricted-image-viewed"]
    assert reads
    assert {event["target_id"] for event in reads} == {str(lab.slides[CLINICAL])}
    assert all(set(json.loads(event["details"])) == {"image"} for event in reads)


def test_erasing_a_patient_deletes_the_labels_of_their_slides(
    api: ApiAs, database: str, lab: Lab
) -> None:
    lead = lab.people["owner"]
    project = lab.projects[CLINICAL]
    _, slide, patient = case_with_slide(api, database, lead, project, patient=True)
    give_images(database, lab.tenant_id, slide, list(RestrictedImage))
    base = f"/api/projects/{project}/patients/{patient}"

    exported = ok(api(lead).get(f"{base}/personal-data")).json()
    assert [entry["restricted_images"] for entry in exported["slides"]] == [["label", "macro"]]
    assert b"label of" not in json.dumps(exported).encode()

    erased = ok(api(lead).delete(base)).json()
    assert (erased["cases_unlinked"], erased["restricted_images_deleted"]) == (1, 2)
    assert stored_keys(restricted_prefix(lab.tenant_id, slide)) == []
    assert owner(database, f"SELECT restricted_images FROM slides WHERE id = '{slide}'") == [([],)]
    path = f"/api/slides/{slide}/restricted-images/label"
    assert problem_of(api(lead).get(path)) == HIDDEN
    details = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE tenant_id = '{lab.tenant_id}' AND action = 'patient.erased' "
        f"AND target_id = '{patient}'",
    )
    assert details == [('{"cases_unlinked":1,"restricted_images_deleted":2}',)]
