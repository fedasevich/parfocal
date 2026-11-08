from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs, api_settings
from fastapi.testclient import TestClient
from fixture_support import fixture_path
from link_support import Served, Site, serving
from upload_support import Lab, run_worker, single, status_of

from parfocal_api.app import create_app
from parfocal_common.link_fetch import LINK_FAILURES, LinkRefusal

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SLIDE = "CMU-1-Small-Region.svs"
REGIONS = (
    Path(__file__).resolve().parents[3]
    / "workers"
    / "ingest"
    / "tests"
    / "fixtures"
    / "results"
    / "regions.geojson"
).read_bytes()


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


def listing(api: ApiAs, lab: Lab, address: str) -> Any:
    return api(lab.lead).get(
        f"/api/projects/{lab.project}/source-files", params={"address": address}
    )


def start(api: ApiAs, lab: Lab, address: str, names: list[str]) -> Any:
    return api(lab.lead).post(
        f"/api/projects/{lab.project}/link-imports", json={"address": address, "names": names}
    )


def refused(response: Any, refusal: LinkRefusal) -> None:
    assert response.status_code == 400, response.text
    assert (response.json()["code"], response.json()["detail"]) == (
        "link-refused",
        LINK_FAILURES[refusal],
    )


@pytest.mark.parametrize(
    "address",
    [
        "https://127.0.0.1/slides/",
        "https://localhost/slides/",
        "https://10.0.0.5/scan.svs",
        "https://192.168.1.20/scan.svs",
        "https://169.254.169.254/latest/meta-data/",
        "https://[::1]/scan.svs",
        "https://[::ffff:127.0.0.1]/scan.svs",
        "https://[fe80::1]/scan.svs",
    ],
)
def test_a_link_to_a_private_address_is_refused(api: ApiAs, lab: Lab, address: str) -> None:
    refused(listing(api, lab, address), LinkRefusal.ADDRESS)


def test_only_https_is_fetched_from_an_untrusted_origin(api: ApiAs, lab: Lab, site: Site) -> None:
    site.file("/scan.svs", b"slide")
    refused(listing(api, lab, site.url("/scan.svs")), LinkRefusal.SCHEME)
    refused(listing(api, lab, "file:///etc/passwd"), LinkRefusal.SCHEME)
    assert site.requests == []


@pytest.mark.parametrize(
    "target", ["https://169.254.169.254/latest/meta-data/", "https://10.1.2.3/scan.svs"]
)
def test_a_redirect_to_a_private_address_is_refused(
    linked: ApiAs, lab: Lab, site: Site, target: str
) -> None:
    site.routes["/hop"] = Served(302, headers={"location": target})
    refused(listing(linked, lab, site.url("/hop")), LinkRefusal.ADDRESS)
    assert [path for _, path, _ in site.requests] == ["/hop"]


def test_endless_redirects_are_refused(linked: ApiAs, lab: Lab, site: Site) -> None:
    site.routes["/loop"] = Served(302, headers={"location": "/loop"})
    refused(listing(linked, lab, site.url("/loop")), LinkRefusal.REDIRECTS)


def test_no_platform_credential_is_sent_to_the_link(linked: ApiAs, lab: Lab, site: Site) -> None:
    site.file("/scan.svs", b"slide-bytes")
    linked.client.cookies.set("parfocal_session", "secret")
    assert listing(linked, lab, site.url("/scan.svs")).status_code == 200
    sent = {name.lower() for _, _, headers in site.requests for name in headers}
    assert sent.isdisjoint({"authorization", "cookie", "x-amz-date", "x-amz-content-sha256"})


def test_a_file_larger_than_an_upload_is_listed_as_refused_and_not_imported(
    linked: ApiAs, lab: Lab, site: Site
) -> None:
    site.index("/big/", ["huge.svs"])
    site.file("/big/huge.svs", b"x", head_length=65 * 1024 * 1024)
    response = listing(linked, lab, site.url("/big/"))
    assert response.status_code == 200, response.text
    [file] = response.json()["files"]
    assert (file["name"], file["refused"]) == ("huge.svs", "link-too-large")
    rejected = start(linked, lab, site.url("/big/"), ["huge.svs"])
    assert (rejected.status_code, rejected.json()["code"]) == (400, "nothing-chosen")


def test_a_file_that_grows_past_its_listed_size_is_refused_while_fetching(
    linked: ApiAs, database: str, lab: Lab, site: Site, tmp_path: Path
) -> None:
    site.index("/grow/", ["grows.svs"])
    site.file("/grow/grows.svs", b"y" * 4096, head_length=1024)
    started = start(linked, lab, site.url("/grow/"), ["grows.svs"])
    assert started.status_code == 202, started.text
    [upload] = started.json()["started"]
    run_worker(database, lab.tenant_id, tmp_path / "work", (site.origin,))
    state = status_of(linked, lab.lead, {"uploadId": upload["upload_id"]})
    assert (state["status"], state["reason"]) == ("failed", "link-too-large")
    assert single(database, f"SELECT status FROM uploads WHERE id = '{upload['upload_id']}'") == (
        "aborted",
    )


def test_a_slide_from_a_link_is_published_and_a_second_copy_is_left_out_by_checksum(
    linked: ApiAs, database: str, lab: Lab, site: Site, tmp_path: Path
) -> None:
    data = fixture_path(SLIDE).read_bytes()
    site.index("/scans/", [SLIDE, "CMU-1-Small-Region.geojson", "notes.txt"])
    site.file(f"/scans/{SLIDE}", data)
    site.file("/scans/CMU-1-Small-Region.geojson", REGIONS)
    site.file("/scans/notes.txt", b"notes")

    found = listing(linked, lab, site.url("/scans/"))
    assert found.status_code == 200, found.text
    [file] = found.json()["files"]
    assert (file["name"], file["size_bytes"], file["in_project"], file["refused"]) == (
        SLIDE,
        len(data),
        False,
        None,
    )
    assert file["result"]["name"] == "CMU-1-Small-Region.geojson"
    assert found.json()["others"] == ["notes.txt"]

    started = start(linked, lab, site.url("/scans/"), [SLIDE])
    assert started.status_code == 202, started.text
    kinds = {item["kind"]: item for item in started.json()["started"]}
    assert set(kinds) == {"slide", "result"}
    slide_upload = {"uploadId": kinds["slide"]["upload_id"]}
    assert status_of(linked, lab.lead, slide_upload)["status"] == "uploading"

    run_worker(database, lab.tenant_id, tmp_path / "work", (site.origin,))
    published = status_of(linked, lab.lead, slide_upload)
    assert published["status"] == "ready", published
    result = status_of(linked, lab.lead, {"uploadId": kinds["result"]["upload_id"]})
    assert (result["upload_status"], result["slide_upload_id"], result["slide_id"]) == (
        "completed",
        slide_upload["uploadId"],
        published["slide_id"],
    )
    assert single(
        database,
        f"SELECT sha256, file_bytes FROM slides WHERE id = '{published['slide_id']}'",
    )[1] == len(data)

    again = listing(linked, lab, site.url("/scans/"))
    assert again.json()["files"][0]["in_project"] is True

    site.index("/copies/", ["renamed-copy.svs"])
    site.file("/copies/renamed-copy.svs", data)
    copy = start(linked, lab, site.url("/copies/"), ["renamed-copy.svs"])
    assert copy.status_code == 202, copy.text
    [second] = copy.json()["started"]
    run_worker(database, lab.tenant_id, tmp_path / "work", (site.origin,))
    left_out = status_of(linked, lab.lead, {"uploadId": second["upload_id"]})
    assert (left_out["status"], left_out["reason"], left_out["failure_class"]) == (
        "skipped",
        "duplicate",
        None,
    )
    assert left_out["message"] == "Skipped, already in this project."
    assert single(database, f"SELECT count(*) FROM slides WHERE project_id = '{lab.project}'") == (
        1,
    )
