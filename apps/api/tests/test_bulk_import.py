import shutil
import uuid
from pathlib import Path

import httpx2
import pytest
from db_support import ApiAs
from fixture_support import fixture_path
from upload_support import Lab, run_worker, start_upload
from workspace_support import make_case, owner

from parfocal_api.bulk_import import (
    Outcome,
    dropped_files,
    import_folder,
    import_named,
    main,
    read_manifest,
    wait_for,
)

CASES = [f"S26-{number}" for number in range(201, 206)]
REGIONS = (
    Path(__file__).resolve().parents[3]
    / "workers"
    / "ingest"
    / "tests"
    / "fixtures"
    / "results"
    / "regions.geojson"
)


def pilot_folder(root: Path) -> Path:
    source = fixture_path("synthetic-jpeg.tiff")
    folder = root / "pilot"
    (folder / "S26-301").mkdir(parents=True)
    shutil.copy(source, folder / "S26-301" / "A1_HE.tiff")
    shutil.copy(REGIONS, folder / "S26-301" / "A1_HE.geojson")
    shutil.copy(source, folder / "S26-302_B1.tiff")
    shutil.copy(REGIONS, folder / "S26-302_B1.geojson")
    (folder / ".DS_Store").write_bytes(b"x")
    (folder / "manifest.csv").write_text("file,case\n")
    return folder


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


def test_hidden_files_and_the_manifest_are_not_dropped(tmp_path: Path) -> None:
    folder = pilot_folder(tmp_path)
    assert [path.relative_to(folder).as_posix() for path in dropped_files(folder)] == [
        "S26-301/A1_HE.geojson",
        "S26-301/A1_HE.tiff",
        "S26-302_B1.geojson",
        "S26-302_B1.tiff",
    ]


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_a_file_without_a_case_or_a_slide_stops_the_named_import(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    folder = pilot_folder(tmp_path)
    shutil.copy(fixture_path("synthetic-jpeg.tiff"), folder / "overview.tiff")
    shutil.copy(REGIONS, folder / "stray.geojson")
    (folder / "notes.txt").write_text("x")
    with httpx2.Client(timeout=30) as storage:
        report = import_named(api(lab.lead), storage, lab.project, folder)
    assert not report.ok
    assert sorted((item.column, item.message) for item in report.problems) == [
        ("pilot/notes.txt", "Neither a slide nor a result"),
        ("pilot/overview.tiff", "No case number in its folder or file name"),
        ("pilot/stray.geojson", "The result matches no slide"),
    ]
    assert owner(database, f"SELECT count(*) FROM cases WHERE project_id = '{lab.project}'") == [
        (0,)
    ]


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_slides_and_results_land_in_cases_named_by_their_folders_and_files(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    folder = pilot_folder(tmp_path)
    with httpx2.Client(timeout=30) as storage:
        checked = import_named(api(lab.lead), storage, lab.project, folder, dry_run=True)
        assert (checked.ok, checked.cases_created, checked.cases_existing) == (True, 2, 0)
        assert sorted((item.file, item.case, item.outcome) for item in checked.files) == [
            ("pilot/S26-301/A1_HE.geojson", "pilot/S26-301/A1_HE.tiff", Outcome.PLANNED),
            ("pilot/S26-301/A1_HE.tiff", "S26-301", Outcome.PLANNED),
            ("pilot/S26-302_B1.geojson", "pilot/S26-302_B1.tiff", Outcome.PLANNED),
            ("pilot/S26-302_B1.tiff", "S26-302", Outcome.PLANNED),
        ]
        assert owner(
            database, f"SELECT count(*) FROM cases WHERE project_id = '{lab.project}'"
        ) == [(0,)]

        report = import_named(api(lab.lead), storage, lab.project, folder)
        assert {item.outcome for item in report.files} == {Outcome.UPLOADED}
        run_worker(database, lab.tenant_id, tmp_path / "work")
        wait_for(api(lab.lead), report.files, 0, lambda _: None, lambda: 0, import_as_is=True)
        run_worker(database, lab.tenant_id, tmp_path / "work")
        wait_for(api(lab.lead), report.files, 0, lambda _: None, lambda: 0, import_as_is=True)
        assert report.ok, report
        assert {item.status for item in report.files} == {"ready"}

        placed = owner(
            database,
            "SELECT c.label, s.label, count(r.id) FROM slides s "
            "JOIN cases c ON c.id = s.case_id "
            "LEFT JOIN result_sets r ON r.slide_id = s.id AND r.deleted_at IS NULL "
            f"WHERE s.project_id = '{lab.project}' AND s.published_at IS NOT NULL "
            "GROUP BY c.label, s.label ORDER BY c.label",
        )
        assert placed == [("S26-301", "A1_HE", 1), ("S26-302", "S26-302_B1", 1)]

        again = import_named(api(lab.lead), storage, lab.project, folder)
    assert (again.ok, again.cases_created, again.cases_existing) == (True, 0, 2)
    assert sorted(item.outcome for item in again.files) == sorted(
        [Outcome.ALREADY_IN_CASE] * 2 + [Outcome.ALREADY_IMPORTED] * 2
    )
    assert owner(database, f"SELECT count(*) FROM uploads WHERE project_id = '{lab.project}'") == [
        (4,)
    ]
