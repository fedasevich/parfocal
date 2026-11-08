import shutil
import uuid
from pathlib import Path

import httpx2
import pytest
from db_support import ApiAs
from fixture_support import fixture_path
from upload_support import Lab, run_worker, start_upload
from workspace_support import make_case, owner

from parfocal_api.bulk_import import Outcome, import_folder, main, read_manifest, wait_for

CASES = [f"S26-{number}" for number in range(201, 206)]


def slide_folder(root: Path) -> tuple[Path, str]:
    source = fixture_path("synthetic-jpeg.tiff")
    folder = root / "slides"
    lines = ["File,Case"]
    for index in range(20):
        case = CASES[index // 4]
        relative = (
            Path(case) / f"block-{index % 4 + 1}.tiff"
            if index % 2
            else Path(f"{case}_level-{index % 4 + 1}.tiff")
        )
        (folder / relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, folder / relative)
        lines.append(f"{relative.as_posix()},{case}")
    return folder, "\n".join(lines) + "\n"


def test_the_manifest_names_every_row_it_cannot_use(tmp_path: Path) -> None:
    (tmp_path / "a.tiff").write_bytes(b"x")
    (tmp_path.parent / "outside.tiff").write_bytes(b"x")
    manifest = read_manifest(
        "file,case,stain\n"
        "a.tiff,S26-1,H&E\n"
        "missing.tiff,S26-1,\n"
        "../outside.tiff,S26-1,\n"
        "./a.tiff,S26-2,\n"
        "a.tiff,,\n"
        "a.tiff,~,\n"
        ",,\n",
        tmp_path,
    )
    assert [(item.row, item.column, item.message) for item in manifest.problems] == [
        (1, None, "Unknown columns: stain"),
        (3, "file", "No such file: missing.tiff"),
        (4, "file", "The file must be inside the folder"),
        (5, "file", "The file is listed on row 2"),
        (6, "case", "The case is empty"),
        (7, "case", "~ cannot be a case label"),
    ]
    assert [item.case for item in manifest.files] == ["S26-1"]
    assert read_manifest("name,case\n", tmp_path).problems[0].message == "Missing columns: file"


def test_a_manifest_with_problems_sends_nothing(tmp_path: Path) -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise AssertionError(request.url)

    with httpx2.Client(transport=httpx2.MockTransport(refuse), base_url="http://api") as client:
        report = import_folder(
            client, client, uuid.uuid4(), tmp_path, "file,case\nnone.tiff,S26-1\n"
        )
    assert not report.ok
    assert report.files == []


def test_the_command_asks_for_a_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("PARFOCAL_API_TOKEN", raising=False)
    assert main([str(tmp_path), "--project", "00000000-0000-0000-0000-000000000001"]) == 2
    assert "PARFOCAL_API_TOKEN" in capsys.readouterr().err


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_twenty_fixture_slides_land_in_five_cases(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    folder, manifest = slide_folder(tmp_path)
    early = make_case(database, lab.tenant_id, lab.project, CASES[0])
    first = folder / f"{CASES[0]}_level-1.tiff"
    start_upload(
        api,
        lab.lead,
        lab.project,
        first.name,
        first.stat().st_size,
        case_id=str(early),
        last_modified=int(first.stat().st_mtime * 1000),
    )

    with httpx2.Client(timeout=30) as storage:
        checked = import_folder(api(lab.lead), storage, lab.project, folder, manifest, dry_run=True)
        assert (checked.ok, checked.cases_created, checked.cases_existing) == (True, 4, 1)
        assert checked.files == []

        report = import_folder(api(lab.lead), storage, lab.project, folder, manifest)
        assert report.ok, report
        assert (report.cases_created, report.cases_existing) == (4, 1)
        outcomes = [item.outcome for item in report.files]
        assert outcomes == [Outcome.RESUMED] + [Outcome.UPLOADED] * 19

        run_worker(database, lab.tenant_id, tmp_path / "work")
        wait_for(api(lab.lead), report.files, 0, lambda _: None, lambda: 0)
        assert {item.status for item in report.files} == {"ready"}

        rows = owner(
            database,
            "SELECT c.label, s.label FROM slides s JOIN cases c ON c.id = s.case_id "
            f"WHERE s.project_id = '{lab.project}' AND s.published_at IS NOT NULL "
            "ORDER BY c.label, s.label",
        )
        assert len(rows) == 20
        by_case = {
            case: sorted(str(slide) for label, slide in rows if label == case) for case in CASES
        }
        assert all(len(found) == 4 for found in by_case.values()), by_case
        assert by_case[CASES[1]] == [
            "S26-202_level-1",
            "S26-202_level-3",
            "block-2",
            "block-4",
        ]
        assert owner(
            database,
            f"SELECT count(*) FROM cases WHERE project_id = '{lab.project}' AND source = 'import'",
        ) == [(4,)]

        again = import_folder(api(lab.lead), storage, lab.project, folder, manifest)
    assert (again.ok, again.cases_created, again.cases_existing) == (True, 0, 5)
    assert {item.outcome for item in again.files} == {Outcome.ALREADY_IN_CASE}
    assert owner(database, f"SELECT count(*) FROM slides WHERE project_id = '{lab.project}'") == [
        (20,)
    ]
