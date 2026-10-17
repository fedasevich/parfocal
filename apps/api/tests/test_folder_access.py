import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import make_tenant, owner, person

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db


@dataclass(frozen=True)
class Lab:
    tenant_id: uuid.UUID
    people: dict[str, MemberPrincipal]
    folders: dict[str, str]
    cases: dict[str, str]


def make_lab(api: ApiAs, database: str) -> Lab:
    tenant_id = make_tenant(database)
    people = {
        "head": person(database, tenant_id, "head", Role.LEAD),
        "lead": person(database, tenant_id, "lead", Role.LEAD),
        "nodes": person(database, tenant_id, "nodes", Role.CONSULTANT),
        "lab": person(database, tenant_id, "lab", Role.LAB),
    }
    owner(
        database,
        f"UPDATE memberships SET all_folders = true WHERE user_id = '{people['head'].user_id}'",
    )
    head = people["head"]
    folders = {
        name: api(head).post("/api/tenant/folders", json={"name": name}).json()["id"]
        for name in ("Nodes", "Skin")
    }
    api(head).put(
        f"/api/tenant/folders/{folders['Nodes']}/people",
        json={"user_ids": [str(people["nodes"].user_id), str(people["lab"].user_id)]},
    )
    cases: dict[str, str] = {}
    for label, folder in (
        ("nodes", folders["Nodes"]),
        ("skin", folders["Skin"]),
        ("unfiled", None),
    ):
        body: dict[str, Any] = {
            "patient": {"name": f"Patient {label}"},
            "accession": f"FA-{uuid.uuid4().hex[:8]}",
            "specimens": [{"letter": "A"}],
        }
        if folder:
            body["folder_id"] = folder
        response = api(head).post("/api/cases", json=body)
        assert response.status_code == 201, response.text
        cases[label] = response.json()["id"]
    return Lab(tenant_id, people, folders, cases)


def listed(api: ApiAs, who: MemberPrincipal) -> set[str]:
    return {case["id"] for case in api(who).get("/api/cases").json()}


def test_the_case_list_hides_cases_of_other_folders(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    assert listed(api, lab.people["nodes"]) == {lab.cases["nodes"], lab.cases["unfiled"]}
    assert listed(api, lab.people["lead"]) == {lab.cases["unfiled"]}
    assert listed(api, lab.people["head"]) == set(lab.cases.values())


def test_opening_a_case_outside_the_folders_is_refused(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    nodes = lab.people["nodes"]
    assert api(nodes).get(f"/api/cases/{lab.cases['nodes']}").status_code == 200
    assert api(nodes).get(f"/api/cases/{lab.cases['unfiled']}").status_code == 200
    refused = api(nodes).get(f"/api/cases/{lab.cases['skin']}")
    assert (refused.status_code, refused.json()["code"]) == (403, "outside-folders")


def test_cases_are_created_and_filed_only_inside_the_folders(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    clerk = lab.people["lab"]
    body = {
        "patient": {"name": "X"},
        "accession": f"FA-{uuid.uuid4().hex[:8]}",
        "specimens": [{"letter": "A"}],
        "folder_id": lab.folders["Skin"],
    }
    refused = api(clerk).post("/api/cases", json=body)
    assert (refused.status_code, refused.json()["code"]) == (403, "outside-folders")
    into_skin = api(clerk).put(
        f"/api/cases/{lab.cases['unfiled']}/folder", json={"folder_id": lab.folders["Skin"]}
    )
    assert into_skin.status_code == 403
    out_of_skin = api(clerk).put(
        f"/api/cases/{lab.cases['skin']}/folder", json={"folder_id": lab.folders["Nodes"]}
    )
    assert out_of_skin.status_code == 403
    into_nodes = api(clerk).put(
        f"/api/cases/{lab.cases['unfiled']}/folder", json={"folder_id": lab.folders["Nodes"]}
    )
    assert into_nodes.status_code == 200


def test_only_leads_work_in_every_folder(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    head = lab.people["head"]
    path = "/api/tenant/members/{}/all-folders"
    refused = api(head).put(path.format(lab.people["nodes"].user_id), json={"all_folders": True})
    assert (refused.status_code, refused.json()["code"]) == (409, "all-folders-for-leads")
    granted = api(head).put(path.format(lab.people["lead"].user_id), json={"all_folders": True})
    assert granted.json() == {"all_folders": True}
    assert listed(api, lab.people["lead"]) == set(lab.cases.values())
    with pytest.raises(Exception, match="check constraint"):
        owner(
            database,
            "UPDATE memberships SET all_folders = true "
            f"WHERE user_id = '{lab.people['nodes'].user_id}'",
        )
