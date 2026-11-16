import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import tifffile
from db_support import ApiAs, api_settings
from fastapi.testclient import TestClient
from fixture_support import fixture_path
from link_support import Site, serving
from upload_support import keys_under, run_worker, send_file, single, start_upload, status_of
from workspace_support import join_project, make_case, make_project, make_workspace, owner

from parfocal_api.app import create_app
from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.tables import Role
from parfocal_common.ingest import restricted_prefix, restricted_ranges_key, slide_prefix

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage", "slide_bytes")]

SLIDE = "labelled.ome.tiff"
SOURCE = "synthetic-zlib.ome.tiff"
TILE = 256
PIXELS_PER_CENTIMETRE = 2e4
CASE_LABEL = "S26-4711"
REASON = "The study moves to pseudonymised research data only"


@dataclass(frozen=True)
class Study:
    tenant_id: uuid.UUID
    lead: MemberPrincipal
    colleague: MemberPrincipal
    clinical: uuid.UUID
    research: uuid.UUID


@pytest.fixture
def study(database: str) -> Study:
    workspace = make_workspace(
        database,
        {"lead": Role.RESEARCHER, "colleague": Role.RESEARCHER},
        admins=("lead",),
    )
    clinical = make_project(database, workspace.tenant_id, "clinical")
    research = make_project(database, workspace.tenant_id, "de-identified")
    for project in (clinical, research):
        join_project(database, project, workspace.people["lead"], "owner")
        join_project(database, project, workspace.people["colleague"], "viewer")
    return Study(
        workspace.tenant_id,
        workspace.people["lead"],
        workspace.people["colleague"],
        clinical,
        research,
    )


def write_labelled_slide(path: Path) -> bytes:
    with tifffile.TiffFile(fixture_path(SOURCE)) as source:
        levels = [level.asarray() for level in source.series[0].levels]
    with tifffile.TiffWriter(path, ome=True) as tiff:
        tiff.write(
            levels[0],
            photometric="rgb",
            tile=(TILE, TILE),
            compression="zlib",
            subifds=len(levels) - 1,
            resolution=(PIXELS_PER_CENTIMETRE, PIXELS_PER_CENTIMETRE),
            resolutionunit="CENTIMETER",
            metadata={"axes": "YXS", "Name": "slide", "PhysicalSizeX": 0.5, "PhysicalSizeY": 0.5},
        )
        for index, level in enumerate(levels[1:], start=1):
            tiff.write(
                level,
                photometric="rgb",
                tile=(TILE, TILE),
                compression="zlib",
                subfiletype=1,
                resolution=(PIXELS_PER_CENTIMETRE / 2**index, PIXELS_PER_CENTIMETRE / 2**index),
                resolutionunit="CENTIMETER",
            )
        noise = np.random.default_rng(7)
        for name, shape in (("label", (120, 160, 3)), ("macro", (160, 400, 3))):
            tiff.write(
                noise.integers(0, 255, shape, dtype=np.uint8),
                photometric="rgb",
                metadata={"axes": "YXS", "Name": name},
            )
    return path.read_bytes()


@pytest.fixture
def slide_bytes(tmp_path: Path) -> bytes:
    return write_labelled_slide(tmp_path / SLIDE)


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


def uploaded(
    api: ApiAs,
    database: str,
    study: Study,
    who: Principal,
    project: uuid.UUID,
    work: Path,
    **meta: Any,
) -> uuid.UUID:
    data = (work.parent / SLIDE).read_bytes()
    upload = start_upload(api, who, project, SLIDE, len(data), **meta)
    send_file(api, who, upload, data)
    run_worker(database, study.tenant_id, work)
    return published(database, upload["uploadId"])


def published(database: str, upload_id: str) -> uuid.UUID:
    [found] = owner(database, f"SELECT id FROM slides WHERE upload_id = '{upload_id}'")
    return uuid.UUID(str(found[0]))


def restricted_of(database: str, slide_id: uuid.UUID) -> list[str]:
    return single(database, f"SELECT restricted_images FROM slides WHERE id = '{slide_id}'")[0]


def holds_no_label_or_macro(api: ApiAs, database: str, study: Study, slide_id: uuid.UUID) -> None:
    assert restricted_of(database, slide_id) == []
    assert keys_under(restricted_prefix(study.tenant_id, slide_id)) == set()
    for image in ("label", "macro"):
        response = api(study.lead).get(f"/api/slides/{slide_id}/restricted-images/{image}")
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "restricted-image-not-found"


def test_an_upload_into_a_de_identified_project_stores_no_label_or_macro(
    api: ApiAs, database: str, study: Study, tmp_path: Path
) -> None:
    slide_id = uploaded(api, database, study, study.lead, study.research, tmp_path / "work")
    holds_no_label_or_macro(api, database, study, slide_id)
    assert restricted_ranges_key(study.tenant_id, slide_id).removeprefix(
        slide_prefix(study.tenant_id, slide_id)
    ) in keys_under(slide_prefix(study.tenant_id, slide_id))

    owner(database, f"UPDATE projects SET privacy_mode = 'clinical' WHERE id = '{study.research}'")
    later = api(study.colleague).get(f"/api/slides/{slide_id}/restricted-images/label")
    assert (later.status_code, later.json()["code"]) == (404, "restricted-image-not-found")


def test_a_service_account_upload_into_a_de_identified_project_stores_no_label_or_macro(
    api: ApiAs, database: str, study: Study, tmp_path: Path
) -> None:
    account = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO service_accounts (tenant_id, name, scopes) "
                f"VALUES ('{study.tenant_id}', 'Scanner hook', '{{upload-slides}}') RETURNING id",
            )[0][0]
        )
    )
    service = ServicePrincipal(account, study.tenant_id, frozenset({"upload-slides"}))
    slide_id = uploaded(api, database, study, service, study.research, tmp_path / "work")
    holds_no_label_or_macro(api, database, study, slide_id)


def test_a_link_import_into_a_de_identified_project_stores_no_label_or_macro(
    linked: ApiAs, database: str, study: Study, site: Site, slide_bytes: bytes, tmp_path: Path
) -> None:
    site.index("/scans/", [SLIDE])
    site.file(f"/scans/{SLIDE}", slide_bytes)
    started = linked(study.lead).post(
        f"/api/projects/{study.research}/link-imports",
        json={"address": site.url("/scans/"), "names": [SLIDE]},
    )
    assert started.status_code == 202, started.text
    [item] = started.json()["started"]
    run_worker(database, study.tenant_id, tmp_path / "work", (site.origin,))
    assert status_of(linked, study.lead, {"uploadId": item["upload_id"]})["status"] == "ready"
    holds_no_label_or_macro(linked, database, study, published(database, item["upload_id"]))


def test_switching_a_project_to_de_identified_deletes_its_labels_and_macros(
    api: ApiAs, database: str, study: Study, tmp_path: Path
) -> None:
    slide_id = uploaded(api, database, study, study.lead, study.clinical, tmp_path / "work")
    assert restricted_of(database, slide_id) == ["label", "macro"]
    switched = api(study.lead).post(
        f"/api/projects/{study.clinical}/privacy-mode",
        json={"privacy_mode": "de-identified", "reason": REASON},
    )
    assert switched.status_code == 200, switched.text
    holds_no_label_or_macro(api, database, study, slide_id)
    [details] = owner(
        database,
        "SELECT details FROM audit_events WHERE action = 'project.privacy-changed' "
        f"AND target_id = '{study.clinical}'",
    )
    assert json.loads(str(details[0]))["restricted_images_deleted"] == 2


def copy(api: ApiAs, who: Principal, project: uuid.UUID, slide_ids: list[uuid.UUID]) -> Any:
    return api(who).post(
        f"/api/projects/{project}/slide-copies", json={"slide_ids": [str(s) for s in slide_ids]}
    )


def test_a_copy_into_a_de_identified_project_has_a_stable_pseudonym_and_no_label(
    api: ApiAs, database: str, study: Study, tmp_path: Path
) -> None:
    case = make_case(database, study.tenant_id, study.clinical, CASE_LABEL)
    other = make_case(database, study.tenant_id, study.clinical, "S26-4712")
    source = uploaded(
        api,
        database,
        study,
        study.lead,
        study.clinical,
        tmp_path / "work",
        case_id=str(case),
    )
    second = uploaded(
        api,
        database,
        study,
        study.lead,
        study.clinical,
        tmp_path / "work",
        case_id=str(other),
    )
    owner(database, f"UPDATE slides SET barcode = 'BC-99812' WHERE id = '{source}'")
    assert restricted_of(database, source) == ["label", "macro"]

    first = copy(api, study.lead, study.research, [source, second])
    assert first.status_code == 200, first.text
    made, made_other = first.json()["copies"]
    assert made["source_slide_id"] == str(source)
    assert made["case_label"].startswith("Case ")
    assert CASE_LABEL not in made["case_label"]
    assert made["case_label"] != made_other["case_label"]
    copied = uuid.UUID(made["slide_id"])
    holds_no_label_or_macro(api, database, study, copied)
    label, barcode, project, sha = single(
        database, f"SELECT label, barcode, project_id, sha256 FROM slides WHERE id = '{copied}'"
    )
    assert (label, barcode, project) == ("Slide", None, study.research)
    assert sha == single(database, f"SELECT sha256 FROM slides WHERE id = '{source}'")[0]
    assert keys_under(slide_prefix(study.tenant_id, copied)) == keys_under(
        slide_prefix(study.tenant_id, source)
    )
    assert restricted_of(database, source) == ["label", "macro"]

    again = copy(api, study.lead, study.research, [source])
    assert again.status_code == 200, again.text
    [repeat] = again.json()["copies"]
    assert (repeat["case_id"], repeat["case_label"]) == (made["case_id"], made["case_label"])
    assert repeat["slide_id"] != made["slide_id"]

    leaked = owner(
        database,
        "SELECT count(*) FROM cases c FULL JOIN slides s ON s.case_id = c.id "
        f"WHERE coalesce(c.project_id, s.project_id) = '{study.research}' "
        f"AND (c.label LIKE 'S26-%' OR s.label LIKE 'labelled%' OR s.barcode IS NOT NULL)",
    )
    assert leaked == [(0,)]
    [entry] = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE action = 'slide.copied' AND target_id = '{copied}'",
    )
    assert json.loads(str(entry[0]))["from_slide_id"] == str(source)


def test_a_copy_needs_a_de_identified_target_and_an_owner_of_the_source(
    api: ApiAs, database: str, study: Study, tmp_path: Path
) -> None:
    source = uploaded(api, database, study, study.lead, study.clinical, tmp_path / "work")
    other_clinical = make_project(database, study.tenant_id, "clinical")
    join_project(database, other_clinical, study.lead, "owner")
    refused = copy(api, study.lead, other_clinical, [source])
    assert (refused.status_code, refused.json()["code"]) == (
        400,
        "copy-needs-de-identified-project",
    )
    within = make_project(database, study.tenant_id, "de-identified")
    join_project(database, within, study.colleague, "owner")
    by_viewer = copy(api, study.colleague, within, [source])
    assert by_viewer.status_code == 403, by_viewer.text
    unknown = copy(api, study.lead, study.research, [uuid.uuid4()])
    assert unknown.status_code == 404
