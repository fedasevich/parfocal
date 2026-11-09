import base64
import json
import logging
from collections.abc import Iterator
from typing import Any

import pytest
from db_support import ApiAs, api_settings
from fastapi.testclient import TestClient
from link_support import Site, serving
from test_model_runs import Lab, make_lab, ok, problem
from workspace_support import make_project, make_tenant, owner

from parfocal_api.app import create_app
from parfocal_common.lab_model_call import CALL_FAILURES, CallRefusal

pytestmark = pytest.mark.db

MODELS = "/api/tenant/models"
TOKEN = "lab-token-7c41e09d3f9a"
INFER = "/parfocal/infer"


def square(x: int, y: int, side: int = 12) -> dict[str, Any]:
    ring = [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]
    return {"type": "Polygon", "coordinates": [ring]}


def cell(name: str, x: int, y: int) -> dict[str, Any]:
    return {"kind": "cell", "class": name, "score": 0.9, "geometry": square(x, y)}


ANSWER = {
    "model": "lab-hovernet",
    "version": "2.1",
    "objects": [
        {"kind": "region", "class": "tumor", "geometry": square(18440, 9230, 200)},
        cell("neoplastic", 18450, 9240),
        cell("neoplastic", 18480, 9260),
        cell("inflammatory", 18600, 9300),
        cell("dead", 18700, 9400),
    ],
}


@pytest.fixture
def site() -> Iterator[Site]:
    with serving() as served:
        yield served


@pytest.fixture
def linked(database: str, site: Site) -> Iterator[ApiAs]:
    settings = api_settings(database).model_copy(update={"link_trusted_origins": [site.origin]})
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


@pytest.fixture
def lab(linked: ApiAs, database: str) -> Lab:
    return make_lab(linked, database, admins=("owner",))


def server(site: Site, **change: Any) -> dict[str, Any]:
    return {
        "address": site.url(INFER),
        "sign_in": "token",
        "secret": TOKEN,
        "tile_size": 512,
        "magnification": 40,
        **change,
    }


def draft(site: Site, lab: Lab, **change: Any) -> dict[str, Any]:
    return {
        **server(site),
        "name": "Lab HoVer-Net fork",
        "version": "v2.1",
        "taxonomy": "sentinel-node",
        "class_map": [
            {"sent": "neoplastic", "becomes": "Tumor"},
            {"sent": "inflammatory", "becomes": "Immune"},
            {"sent": "tumor", "becomes": "Tumor"},
            {"sent": "dead", "becomes": None},
        ],
        "who_can_run": "researchers",
        "project_ids": [str(lab.project)],
        **change,
    }


def lowered(headers: dict[str, str]) -> dict[str, str]:
    return {name.lower(): value for name, value in headers.items()}


def refused(response: Any, refusal: CallRefusal) -> None:
    assert response.status_code == 400, response.text
    assert (response.json()["code"], response.json()["detail"]) == (
        "lab-model-refused",
        CALL_FAILURES[refusal],
    )


def test_a_passing_test_call_sends_one_sample_tile_and_reads_the_classes(
    linked: ApiAs, lab: Lab, site: Site
) -> None:
    site.json(INFER, ANSWER, server="MONAI Label 0.8")
    tested = ok(linked(lab.people["owner"]).post(f"{MODELS}/test", json=server(site)))
    assert tested["outcome"] == "follows-contract"
    assert tested["model"] == {"name": "lab-hovernet", "version": "2.1"}
    assert tested["returns"] == ["Regions", "Cells"]
    assert tested["server_software"].endswith("MONAI Label 0.8")
    assert tested["missing_geometry"] == 0
    assert tested["classes"] == [
        {"name": "neoplastic", "cells": 2, "suggested": "Tumor"},
        {"name": "dead", "cells": 1, "suggested": None},
        {"name": "inflammatory", "cells": 1, "suggested": "Immune"},
        {"name": "tumor", "cells": 1, "suggested": "Tumor"},
    ]
    [tile] = tested["tiles"]
    assert (tile["regions"], tile["cells"], tile["classes"]) == (1, 4, 4)
    assert tile["outline"]["cells"][0]["class"] == "neoplastic"
    [(method, path, headers)] = site.requests
    assert (method, path, lowered(headers)["authorization"]) == (
        "POST",
        INFER,
        f"Bearer {TOKEN}",
    )
    sent = json.loads(site.bodies[0])
    assert (sent["size"], sent["magnification"], sent["origin"]) == (512, 40, [18432, 9216])
    assert base64.b64decode(sent["tile"].removeprefix("data:image/png;base64,"))[:4] == b"\x89PNG"


def test_a_failing_test_call_says_what_breaks_the_contract(
    linked: ApiAs, lab: Lab, site: Site
) -> None:
    broken = {**ANSWER, "objects": [*ANSWER["objects"], {"kind": "cell", "class": "dead"}]}
    site.json(INFER, broken)
    tested = ok(linked(lab.people["owner"]).post(f"{MODELS}/test", json=server(site)))
    assert tested["outcome"] == "not-contract"
    assert tested["missing_geometry"] == 1
    assert tested["tiles"] == []
    site.json(INFER, {"objects": []})
    tested = ok(linked(lab.people["owner"]).post(f"{MODELS}/test", json=server(site)))
    assert (tested["outcome"], tested["model"]) == ("not-contract", None)


def test_a_server_that_refuses_the_tile_fails_the_test(linked: ApiAs, lab: Lab, site: Site) -> None:
    site.json(INFER, {"error": "no"}, status=500)
    refused(
        linked(lab.people["owner"]).post(f"{MODELS}/test", json=server(site)),
        CallRefusal.STATUS,
    )


def test_a_redirect_is_never_followed(linked: ApiAs, lab: Lab, site: Site) -> None:
    site.json("/elsewhere", ANSWER)
    site.json(INFER, {}, status=307, location=site.url("/elsewhere"))
    refused(
        linked(lab.people["owner"]).post(f"{MODELS}/test", json=server(site)),
        CallRefusal.REDIRECT,
    )
    assert [path for _, path, _ in site.requests] == [INFER]


@pytest.mark.parametrize(
    "address",
    [
        "https://127.0.0.1/infer",
        "https://localhost/infer",
        "https://10.0.0.5/infer",
        "https://169.254.169.254/latest/meta-data/",
        "https://[::ffff:127.0.0.1]/infer",
        "https://[fe80::1]/infer",
    ],
)
def test_a_private_address_is_refused_when_tested_and_when_saved(
    linked: ApiAs, lab: Lab, site: Site, address: str
) -> None:
    acting = linked(lab.people["owner"])
    refused(acting.post(f"{MODELS}/test", json=server(site, address=address)), CallRefusal.ADDRESS)
    refused(acting.post(MODELS, json=draft(site, lab, address=address)), CallRefusal.ADDRESS)


def test_plain_http_is_refused_for_an_untrusted_server(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database, admins=("owner",))
    body = {"address": "http://ml.example.org/infer", "sign_in": "none"}
    refused(api(lab.people["owner"]).post(f"{MODELS}/test", json=body), CallRefusal.SCHEME)


def test_a_connected_model_keeps_its_class_map_projects_and_a_sealed_token(
    linked: ApiAs, lab: Lab, site: Site, database: str, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    site.json(INFER, ANSWER)
    acting = linked(lab.people["owner"])
    connected = acting.post(MODELS, json=draft(site, lab))
    assert connected.status_code == 201, connected.text
    model = connected.json()
    assert model["class_map"] == draft(site, lab)["class_map"]
    assert model["project_ids"] == [str(lab.project)]
    assert (model["last_four"], model["host"], model["who_can_run"]) == (
        TOKEN[-4:],
        site.origin,
        "researchers",
    )
    assert "secret" not in model
    assert ok(acting.get(f"{MODELS}/{model['id']}")) == model
    [(stored,)] = owner(
        database, f"SELECT secret_ciphertext FROM lab_models WHERE id = '{model['id']}'"
    )
    assert isinstance(stored, bytes)
    assert TOKEN.encode() not in bytes(stored)
    tested = ok(acting.post(f"{MODELS}/{model['id']}/test"))
    assert tested["outcome"] == "follows-contract"
    assert lowered(site.requests[-1][2])["authorization"] == f"Bearer {TOKEN}"
    actions = owner(
        database,
        "SELECT action, details::text FROM audit_events "
        f"WHERE tenant_id = '{lab.tenant}' AND action LIKE 'lab-model.%' ORDER BY seq",
    )
    assert [action for action, _ in actions] == ["lab-model.connected", "lab-model.tested"]
    assert all(TOKEN not in str(details) for _, details in actions)
    assert TOKEN not in caplog.text
    assert "lab-hovernet" not in caplog.text


def test_a_header_sign_in_sends_the_named_header(linked: ApiAs, lab: Lab, site: Site) -> None:
    site.json(INFER, ANSWER)
    body = draft(site, lab, sign_in="header", header_name="X-Api-Key")
    model = ok(linked(lab.people["owner"]).post(MODELS, json=body))
    assert (model["sign_in"], model["header_name"]) == ("header", "X-Api-Key")
    ok(linked(lab.people["owner"]).post(f"{MODELS}/{model['id']}/test"))
    headers = lowered(site.requests[-1][2])
    assert headers["x-api-key"] == TOKEN
    assert "authorization" not in headers


def test_the_class_map_names_only_classes_of_the_taxonomy(
    linked: ApiAs, lab: Lab, site: Site
) -> None:
    acting = linked(lab.people["owner"])
    unknown = [{"sent": "neoplastic", "becomes": "Neoplastic"}]
    assert problem(acting.post(MODELS, json=draft(site, lab, class_map=unknown))) == (
        400,
        "lab-model-class-unknown",
    )
    pannuke = draft(site, lab, taxonomy="pannuke", class_map=unknown)
    assert ok(acting.post(MODELS, json=pannuke))["taxonomy"] == "pannuke"
    twice = [{"sent": "dead", "becomes": None}, {"sent": "Dead", "becomes": None}]
    assert acting.post(MODELS, json=draft(site, lab, class_map=twice)).status_code == 422


def test_a_token_is_needed_and_a_model_is_connected_once(
    linked: ApiAs, lab: Lab, site: Site
) -> None:
    acting = linked(lab.people["owner"])
    assert problem(acting.post(MODELS, json=draft(site, lab, secret=None))) == (
        400,
        "lab-model-secret-missing",
    )
    ok(acting.post(MODELS, json=draft(site, lab)))
    assert problem(acting.post(MODELS, json=draft(site, lab))) == (409, "lab-model-exists")


def test_only_projects_of_the_workspace_may_use_the_model(
    linked: ApiAs, lab: Lab, site: Site, database: str
) -> None:
    elsewhere = make_project(database, make_tenant(database))
    body = draft(site, lab, project_ids=[str(lab.project), str(elsewhere)])
    assert problem(linked(lab.people["owner"]).post(MODELS, json=body)) == (
        400,
        "lab-model-project-not-found",
    )


def test_only_people_with_admin_rights_connect_or_test_a_model(
    linked: ApiAs, lab: Lab, site: Site
) -> None:
    site.json(INFER, ANSWER)
    for who in ("viewer", "reader"):
        assert linked(lab.people[who]).post(MODELS, json=draft(site, lab)).status_code == 403
        assert linked(lab.people[who]).post(f"{MODELS}/test", json=server(site)).status_code == 403
    assert site.requests == []


@pytest.mark.parametrize("userinfo", ["key@", "user:secret-pass@"])
def test_an_address_with_credentials_is_refused_and_never_stored(
    linked: ApiAs, lab: Lab, site: Site, database: str, userinfo: str
) -> None:
    site.json(INFER, ANSWER)
    address = site.url(INFER).replace("http://", f"http://{userinfo}")
    acting = linked(lab.people["owner"])
    refused(
        acting.post(f"{MODELS}/test", json=server(site, address=address)),
        CallRefusal.CREDENTIALS,
    )
    refused(acting.post(MODELS, json=draft(site, lab, address=address)), CallRefusal.CREDENTIALS)
    assert site.requests == []
    stored = owner(database, f"SELECT count(*) FROM lab_models WHERE tenant_id = '{lab.tenant}'")
    assert stored[0][0] == 0


def test_a_deleted_project_may_not_use_the_model(
    linked: ApiAs, lab: Lab, site: Site, database: str
) -> None:
    deleted = make_project(database, lab.tenant)
    owner(database, f"UPDATE projects SET deleted_at = now() WHERE id = '{deleted}'")
    body = draft(site, lab, project_ids=[str(lab.project), str(deleted)])
    assert problem(linked(lab.people["owner"]).post(MODELS, json=body)) == (
        400,
        "lab-model-project-not-found",
    )


def test_a_token_shorter_than_eight_characters_is_refused(
    linked: ApiAs, lab: Lab, site: Site
) -> None:
    acting = linked(lab.people["owner"])
    assert acting.post(MODELS, json=draft(site, lab, secret="abc1234")).status_code == 422
    assert acting.post(f"{MODELS}/test", json=server(site, secret="abc1234")).status_code == 422
    assert site.requests == []


def test_a_deleted_project_leaves_the_models_project_list(
    linked: ApiAs, lab: Lab, site: Site, database: str
) -> None:
    acting = linked(lab.people["owner"])
    model = ok(acting.post(MODELS, json=draft(site, lab)))
    assert model["project_ids"] == [str(lab.project)]
    owner(database, f"UPDATE projects SET deleted_at = now() WHERE id = '{lab.project}'")
    assert ok(acting.get(f"{MODELS}/{model['id']}"))["project_ids"] == []
