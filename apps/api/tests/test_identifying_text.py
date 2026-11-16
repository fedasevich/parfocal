import base64
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import tifffile
from db_support import ApiAs
from pydantic import SecretStr
from storage_support import with_store
from upload_support import run_worker, send_file, single, start_upload
from workspace_support import join_project, make_project, make_slide, make_workspace, owner

from parfocal_api.principals import MemberPrincipal, Principal, ServicePrincipal
from parfocal_api.tables import Role
from parfocal_common.ingest import original_key, restricted_ranges_key
from parfocal_ingest.identifying_text import ranges_file

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SECRET = base64.b64encode(bytes(range(32))).decode()
NAME = "Novakova_Jana_S26-4711"
UPLOAD_NAME = f"{NAME}.svs"
BARCODE = "BC-99812"
TILE = 256
SIZE = 1024
SVS_DESCRIPTION = (
    f"Aperio Image Library v12.0.15\r\n{SIZE}x{SIZE} [0,0 {SIZE}x{SIZE}] ({TILE}x{TILE}) RAW"
    f"|AppMag = 20|StripeWidth = 2040|Filename = {NAME}|User = jana.novakova|MPP = 0.4990"
)
SCN_DESCRIPTION = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<scn xmlns="http://www.leica-microsystems.com/scn/2010/10/01">'
    f'<collection name="{NAME}" uuid="u" sizeX="1" sizeY="1">'
    f"<barcode>{BARCODE}</barcode>"
    '<image name="main" uuid="v"></image></collection></scn>'
)


def pixels(size: int) -> Any:
    return np.random.default_rng(11).integers(0, 255, (size, size, 3), dtype=np.uint8)


def write_svs(path: Path) -> bytes:
    full = pixels(SIZE)
    with tifffile.TiffWriter(path) as tiff:
        for index, level in enumerate((full, full[::2, ::2], full[::4, ::4])):
            tiff.write(
                level,
                photometric="rgb",
                tile=(TILE, TILE),
                compression="zlib",
                description=SVS_DESCRIPTION,
                metadata=None,
                subfiletype=0 if index == 0 else 1,
            )
    return path.read_bytes()


def write_scn(path: Path) -> bytes:
    with tifffile.TiffWriter(path) as tiff:
        tiff.write(
            pixels(512),
            photometric="rgb",
            tile=(TILE, TILE),
            description=SCN_DESCRIPTION,
            metadata=None,
        )
    return path.read_bytes()


def claims_of(token: str) -> dict[str, Any]:
    payload = token.split(".")[0]
    decoded: dict[str, Any] = json.loads(
        base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
    )
    return decoded


def as_edge_serves(data: bytes, claims: dict[str, Any]) -> bytes:
    out = bytearray(data)
    for start, end in claims.get("b", []):
        out[start:end] = b" " * (end - start)
    return bytes(out)


def tile_claims(api: ApiAs, who: Principal, slide_id: uuid.UUID) -> dict[str, Any]:
    api.app.settings = api.app.settings.model_copy(update={"tile_token_key": SecretStr(SECRET)})
    response = api(who).get(f"/api/slides/{slide_id}/tile-access")
    assert response.status_code == 200, response.text
    return claims_of(response.json()["token"])


def stored(key: str) -> bytes:
    return with_store(lambda store: store.get_object(key))


def upload(
    api: ApiAs, database: str, who: MemberPrincipal, project: uuid.UUID, data: bytes, work: Path
) -> uuid.UUID:
    started = start_upload(api, who, project, UPLOAD_NAME, len(data))
    send_file(api, who, started, data)
    run_worker(database, who.tenant_id, work)
    [found] = owner(database, f"SELECT id FROM slides WHERE upload_id = '{started['uploadId']}'")
    return uuid.UUID(str(found[0]))


def test_a_de_identified_project_reads_an_svs_without_the_name_in_its_description(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    workspace = make_workspace(database, {"lead": Role.RESEARCHER})
    lead = workspace.people["lead"]
    research = make_project(database, workspace.tenant_id, "de-identified")
    clinical = make_project(database, workspace.tenant_id, "clinical")
    for project in (research, clinical):
        join_project(database, project, lead, "owner")
    data = write_svs(tmp_path / UPLOAD_NAME)
    slide_id = upload(api, database, lead, research, data, tmp_path / "work")

    label, sha, key = single(
        database, f"SELECT label, sha256, original_key FROM slides WHERE id = '{slide_id}'"
    )
    assert label == "Slide"
    original = stored(key)
    assert hashlib.sha256(original).hexdigest() == sha == hashlib.sha256(data).hexdigest()

    claims = tile_claims(api, lead, slide_id)
    assert claims["b"]
    served = as_edge_serves(original, claims)
    assert len(served) == len(original)
    assert NAME.encode() not in served
    assert b"jana.novakova" not in served
    opened = tmp_path / "served.svs"
    opened.write_bytes(served)
    with tifffile.TiffFile(opened) as tiff:
        assert tiff.is_svs
        assert "MPP = 0.4990" in tiff.pages.first.description
        assert np.array_equal(tiff.pages.first.asarray(), pixels(SIZE))
    assert hashlib.sha256(stored(key)).hexdigest() == sha

    in_clinic = upload(api, database, lead, clinical, data, tmp_path / "work-clinical")
    assert single(database, f"SELECT label FROM slides WHERE id = '{in_clinic}'")[0] == NAME
    assert "b" not in tile_claims(api, lead, in_clinic)


def scn_slide(
    database: str, tenant_id: uuid.UUID, project: uuid.UUID, data: bytes, path: Path
) -> uuid.UUID:
    slide_id = make_slide(database, tenant_id, project, "S1")
    key = original_key(tenant_id, slide_id, "upload.scn")
    owner(
        database,
        f"UPDATE slides SET original_key = '{key}', file_bytes = {len(data)}, "
        f"format = 'leica-scn' WHERE id = '{slide_id}'",
    )
    document = ranges_file(path)
    with_store(lambda store: store.put_object(key, data, "image/tiff"))
    with_store(
        lambda store: store.put_object(
            restricted_ranges_key(tenant_id, slide_id), document, "application/json"
        )
    )
    return slide_id


def test_a_leica_scn_barcode_is_blank_for_every_reader_without_label_rights(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    workspace = make_workspace(database, {"lead": Role.RESEARCHER, "reviewer": Role.REVIEWER})
    lead = workspace.people["lead"]
    reviewer = workspace.people["reviewer"]
    clinical = make_project(database, workspace.tenant_id, "clinical")
    research = make_project(database, workspace.tenant_id, "de-identified")
    for project in (clinical, research):
        join_project(database, project, lead, "owner")
    join_project(database, research, reviewer, "viewer")
    path = tmp_path / "original.scn"
    data = write_scn(path)
    in_clinic = scn_slide(database, workspace.tenant_id, clinical, data, path)
    in_research = scn_slide(database, workspace.tenant_id, research, data, path)
    account = owner(
        database,
        "INSERT INTO service_accounts (tenant_id, name, scopes) "
        f"VALUES ('{workspace.tenant_id}', 'Slide reader', '{{see-slides}}') RETURNING id",
    )[0][0]
    service = ServicePrincipal(
        uuid.UUID(str(account)), workspace.tenant_id, frozenset({"see-slides"})
    )

    assert BARCODE.encode() in as_edge_serves(data, tile_claims(api, lead, in_clinic))
    without_labels = as_edge_serves(data, tile_claims(api, service, in_clinic))
    assert BARCODE.encode() not in without_labels
    assert NAME.encode() in without_labels
    for who in (lead, reviewer):
        served = as_edge_serves(data, tile_claims(api, who, in_research))
        assert BARCODE.encode() not in served
        assert NAME.encode() not in served
        assert len(served) == len(data)


def test_an_old_ranges_file_without_identifying_text_closes_the_whole_original(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    workspace = make_workspace(database, {"lead": Role.RESEARCHER})
    lead = workspace.people["lead"]
    research = make_project(database, workspace.tenant_id, "de-identified")
    join_project(database, research, lead, "owner")
    path = tmp_path / "original.scn"
    data = write_scn(path)
    slide_id = scn_slide(database, workspace.tenant_id, research, data, path)
    old = json.dumps({"ranges": []}).encode()
    with_store(
        lambda store: store.put_object(
            restricted_ranges_key(workspace.tenant_id, slide_id), old, "application/json"
        )
    )
    claims = tile_claims(api, lead, slide_id)
    assert claims["d"] == [[0, len(data)]]
    assert "b" not in claims


def test_switching_to_de_identified_replaces_file_name_labels_and_pairing_keeps_the_name(
    api: ApiAs, database: str, tmp_path: Path
) -> None:
    workspace = make_workspace(database, {"lead": Role.RESEARCHER}, admins=("lead",))
    lead = workspace.people["lead"]
    project = make_project(database, workspace.tenant_id, "clinical")
    join_project(database, project, lead, "owner")
    data = write_svs(tmp_path / UPLOAD_NAME)
    first = upload(api, database, lead, project, data, tmp_path / "work")
    second = upload(api, database, lead, project, data, tmp_path / "work-again")
    labels = {
        row[0]
        for row in owner(database, f"SELECT label FROM slides WHERE project_id = '{project}'")
    }
    assert labels == {NAME, f"{NAME} (2)"}

    switched = api(lead).post(
        f"/api/projects/{project}/privacy-mode",
        json={"privacy_mode": "de-identified", "reason": "Moves to pseudonymised research data"},
    )
    assert switched.status_code == 200, switched.text
    rows = owner(database, f"SELECT id, label FROM slides WHERE project_id = '{project}'")
    named = {str(row[0]): str(row[1]) for row in rows}
    assert {named[str(first)], named[str(second)]} == {"Slide", "Slide (2)"}
    [details] = owner(
        database,
        "SELECT details FROM audit_events WHERE action = 'project.privacy-changed' "
        f"AND target_id = '{project}'",
    )
    assert json.loads(str(details[0]))["slide_labels_replaced"] == 2

    pairing = api(lead).post(
        "/api/uploads/pairings",
        json={
            "project_id": str(project),
            "files": [{"path": f"{NAME}.geojson", "kind": "result"}],
        },
    )
    assert pairing.status_code == 200, pairing.text
    assert NAME not in json.dumps(pairing.json()).replace(f"{NAME}.geojson", "")
    [result] = pairing.json()["results"]
    assert result["candidates"] or result["slide"]
