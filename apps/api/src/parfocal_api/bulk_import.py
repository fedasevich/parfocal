import argparse
import csv
import io
import os
import sys
import time
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path, PurePosixPath
from typing import Any

import httpx2

from parfocal_api.case_imports import PATIENT_COLUMNS, column_name, dialect_of
from parfocal_api.slide_ingest import label_of
from parfocal_common.object_ids import LOOSE_CASE

MANIFEST_COLUMNS = ("file", "case", *PATIENT_COLUMNS)
PUT_ATTEMPTS = 4
FINISHED = {"ready", "failed", "skipped", "waiting"}


class Outcome(StrEnum):
    UPLOADED = "uploaded"
    RESUMED = "resumed"
    ALREADY_IN_CASE = "already-in-case"
    FAILED = "failed"


@dataclass(frozen=True)
class ManifestProblem:
    row: int
    column: str | None
    message: str


@dataclass(frozen=True)
class SlideFile:
    row: int
    path: Path
    case: str


@dataclass
class Manifest:
    columns: list[str] = field(default_factory=list[str])
    rows: list[dict[str, str]] = field(default_factory=list[dict[str, str]])
    files: list[SlideFile] = field(default_factory=list[SlideFile])
    problems: list[ManifestProblem] = field(default_factory=list[ManifestProblem])

    @property
    def cases(self) -> list[str]:
        return list(dict.fromkeys(item.case for item in self.files))

    def case_csv(self) -> str:
        kept = [name for name in self.columns if name != "file"]
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=kept, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(self.rows)
        return out.getvalue()


@dataclass
class FileResult:
    row: int
    file: str
    case: str
    outcome: Outcome
    upload_id: str | None = None
    status: str | None = None
    message: str | None = None


@dataclass
class ImportReport:
    cases_created: int = 0
    cases_existing: int = 0
    files: list[FileResult] = field(default_factory=list[FileResult])
    problems: list[ManifestProblem] = field(default_factory=list[ManifestProblem])

    @property
    def ok(self) -> bool:
        return not self.problems and all(
            item.outcome is not Outcome.FAILED and item.status != "failed" for item in self.files
        )


class ImportStoppedError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def inside(folder: Path, name: str) -> Path | None:
    relative = PurePosixPath(name.replace("\\", "/"))
    if relative.is_absolute() or ".." in relative.parts:
        return None
    return folder.joinpath(*relative.parts)


def read_manifest(text: str, folder: Path) -> Manifest:
    manifest = Manifest()
    reader = csv.DictReader(io.StringIO(text), dialect=dialect_of(text))
    if reader.fieldnames is None:
        manifest.problems.append(ManifestProblem(1, None, "The manifest is empty"))
        return manifest
    manifest.columns = [column_name(name) for name in reader.fieldnames]
    reader.fieldnames = manifest.columns
    missing = [name for name in ("file", "case") if name not in manifest.columns]
    if missing:
        manifest.problems.append(ManifestProblem(1, None, f"Missing columns: {', '.join(missing)}"))
        return manifest
    unknown = [name for name in manifest.columns if name not in MANIFEST_COLUMNS]
    if unknown:
        manifest.problems.append(ManifestProblem(1, None, f"Unknown columns: {', '.join(unknown)}"))
    seen: dict[Path, int] = {}
    for line, row in enumerate(reader, start=2):
        cells = {name: (row.get(name) or "").strip() for name in manifest.columns}
        name, case = cells["file"], cells["case"]
        if not name and not case:
            continue
        if not case:
            manifest.problems.append(ManifestProblem(line, "case", "The case is empty"))
            continue
        if case == LOOSE_CASE:
            manifest.problems.append(ManifestProblem(line, "case", "~ cannot be a case label"))
            continue
        path = inside(folder, name) if name else None
        if path is None:
            message = "The file is empty" if not name else "The file must be inside the folder"
            manifest.problems.append(ManifestProblem(line, "file", message))
            continue
        if not path.is_file():
            manifest.problems.append(ManifestProblem(line, "file", f"No such file: {name}"))
            continue
        resolved = path.resolve()
        if resolved in seen:
            manifest.problems.append(
                ManifestProblem(line, "file", f"The file is listed on row {seen[resolved]}")
            )
            continue
        seen[resolved] = line
        manifest.rows.append(cells)
        manifest.files.append(SlideFile(line, path, case))
    if not manifest.files and not manifest.problems:
        manifest.problems.append(ManifestProblem(2, None, "The manifest lists no files"))
    return manifest


def answer(response: httpx2.Response, *expected: int) -> Any:
    if response.status_code not in (expected or (200,)):
        try:
            body = response.json()
            detail = body.get("detail") or body.get("title") or response.text
        except ValueError:
            detail = response.text
        raise ImportStoppedError(f"{response.request.method} {response.status_code}: {detail}")
    return response.json()


def import_cases(
    api: httpx2.Client, project_id: uuid.UUID, manifest: Manifest, dry_run: bool
) -> Any:
    return answer(
        api.post(
            f"/api/projects/{project_id}/case-imports",
            json={"csv": manifest.case_csv(), "dry_run": dry_run},
        )
    )


def case_ids(api: httpx2.Client, project_id: uuid.UUID) -> dict[str, str]:
    found = answer(api.get("/api/cases", params={"project_id": str(project_id)}))
    return {item["label"]: item["id"] for item in found}


def labels_in(api: httpx2.Client, case_id: str) -> set[str]:
    return {item["label"] for item in answer(api.get(f"/api/cases/{case_id}"))["slides"]}


def put_part(storage: httpx2.Client, url: str, data: bytes, sleep: Callable[[float], None]) -> str:
    for attempt in range(PUT_ATTEMPTS):
        try:
            response = storage.put(url, content=data)
            if response.status_code == 200:
                return response.headers["etag"].strip('"')
            if response.status_code < 500:
                raise ImportStoppedError(f"Storage refused a part with {response.status_code}")
        except httpx2.TransportError:
            if attempt == PUT_ATTEMPTS - 1:
                raise
        sleep(2**attempt)
    raise ImportStoppedError("Storage kept failing on a part")


def open_upload(
    api: httpx2.Client, project_id: uuid.UUID, path: Path, size: int, modified: int
) -> dict[str, Any] | None:
    response = api.get(
        "/api/uploads/open",
        params={
            "project_id": str(project_id),
            "name": path.name,
            "size": size,
            "last_modified": modified,
        },
    )
    if response.status_code == 404:
        return None
    return answer(response)


def send(
    api: httpx2.Client,
    storage: httpx2.Client,
    project_id: uuid.UUID,
    item: SlideFile,
    case_id: str,
    sleep: Callable[[float], None],
) -> tuple[Outcome, str]:
    size = item.path.stat().st_size
    modified = int(item.path.stat().st_mtime * 1000)
    upload = open_upload(api, project_id, item.path, size, modified)
    stored: dict[int, str] = {}
    outcome = Outcome.UPLOADED
    if upload is not None and upload["case_id"] == case_id:
        outcome = Outcome.RESUMED
        query = {"key": upload["key"]}
        parts = answer(api.get(f"/api/uploads/s3/multipart/{upload['uploadId']}", params=query))
        stored = {part["PartNumber"]: part["ETag"].strip('"') for part in parts}
    else:
        upload = answer(
            api.post(
                "/api/uploads/s3/multipart",
                json={
                    "filename": item.path.name,
                    "type": "application/octet-stream",
                    "metadata": {
                        "project_id": str(project_id),
                        "case_id": case_id,
                        "size": size,
                        "last_modified": modified,
                    },
                },
            ),
            201,
        )
    base = f"/api/uploads/s3/multipart/{upload['uploadId']}"
    query = {"key": upload["key"]}
    part_size = int(upload["part_size"])
    etags: list[dict[str, Any]] = []
    with item.path.open("rb") as file:
        for number in range(1, int(upload["part_count"]) + 1):
            if number in stored:
                etags.append({"PartNumber": number, "ETag": stored[number]})
                continue
            file.seek((number - 1) * part_size)
            data = file.read(part_size)
            signed = answer(api.get(f"{base}/{number}", params=query))
            etags.append(
                {"PartNumber": number, "ETag": put_part(storage, signed["url"], data, sleep)}
            )
    answer(api.post(f"{base}/complete", params=query, json={"parts": etags}))
    return outcome, str(upload["uploadId"])


def wait_for(
    api: httpx2.Client,
    results: Iterable[FileResult],
    timeout: float,
    sleep: Callable[[float], None],
    clock: Callable[[], float],
) -> None:
    pending = [item for item in results if item.upload_id is not None]
    deadline = clock() + timeout
    while pending:
        for item in list(pending):
            state = answer(api.get(f"/api/uploads/{item.upload_id}/status"))
            item.status = state["status"]
            if item.status in FINISHED:
                item.message = state.get("message")
                pending.remove(item)
        if not pending or clock() >= deadline:
            return
        sleep(1)


def import_folder(
    api: httpx2.Client,
    storage: httpx2.Client,
    project_id: uuid.UUID,
    folder: Path,
    manifest_text: str,
    *,
    dry_run: bool = False,
    wait_seconds: float = 0,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
    progress: Callable[[FileResult], None] = lambda _: None,
) -> ImportReport:
    manifest = read_manifest(manifest_text, folder)
    report = ImportReport(problems=list(manifest.problems))
    if report.problems:
        return report
    checked = import_cases(api, project_id, manifest, dry_run=True)
    report.cases_created, report.cases_existing = (
        checked["cases_created"],
        checked["cases_existing"],
    )
    report.problems = [
        ManifestProblem(item["row"], item["column"], item["message"])
        for item in checked["problems"]
    ]
    if report.problems or dry_run:
        return report
    import_cases(api, project_id, manifest, dry_run=False)
    ids = case_ids(api, project_id)
    taken = {label: labels_in(api, ids[label]) for label in manifest.cases}
    for item in manifest.files:
        name = item.path.relative_to(folder).as_posix()
        result = FileResult(item.row, name, item.case, Outcome.ALREADY_IN_CASE)
        if label_of(item.path.name) not in taken[item.case]:
            try:
                result.outcome, result.upload_id = send(
                    api, storage, project_id, item, ids[item.case], sleep
                )
            except (ImportStoppedError, httpx2.TransportError) as error:
                result.outcome = Outcome.FAILED
                result.message = getattr(error, "message", None) or type(error).__name__
        report.files.append(result)
        progress(result)
    if wait_seconds > 0:
        wait_for(api, report.files, wait_seconds, sleep, clock)
    return report


def printed(report: ImportReport) -> str:
    lines = [
        f"row {item.row}: {item.message}" + (f" ({item.column})" if item.column else "")
        for item in report.problems
    ]
    for item in report.files:
        status = f" {item.status}" if item.status else ""
        message = f" {item.message}" if item.message else ""
        lines.append(f"{item.file} -> {item.case}: {item.outcome}{status}{message}")
    lines.append(
        f"{report.cases_created} new cases, {report.cases_existing} existing, "
        f"{sum(item.outcome in (Outcome.UPLOADED, Outcome.RESUMED) for item in report.files)} "
        f"files sent, {sum(item.outcome is Outcome.FAILED for item in report.files)} failed"
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m parfocal_api.bulk_import",
        description="Upload a folder of slides into cases named by a CSV manifest",
    )
    parser.add_argument("folder", type=Path)
    parser.add_argument("--manifest", type=Path, help="defaults to manifest.csv in the folder")
    parser.add_argument("--project", type=uuid.UUID, required=True)
    parser.add_argument(
        "--api", default=os.environ.get("PARFOCAL_API_URL", "http://localhost:8000")
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--wait", type=float, default=0, metavar="SECONDS")
    args = parser.parse_args(argv)
    token = os.environ.get("PARFOCAL_API_TOKEN")
    if not token:
        print("Set PARFOCAL_API_TOKEN to a service account token", file=sys.stderr)
        return 2
    folder = args.folder.resolve()
    manifest = (args.manifest or folder / "manifest.csv").read_text(encoding="utf-8-sig")
    headers = {"Authorization": f"Bearer {token}"}
    with (
        httpx2.Client(base_url=args.api, headers=headers, timeout=60) as api,
        httpx2.Client(timeout=300) as storage,
    ):
        try:
            report = import_folder(
                api,
                storage,
                args.project,
                folder,
                manifest,
                dry_run=args.dry_run,
                wait_seconds=args.wait,
                progress=lambda item: print(f"{item.file}: {item.outcome}", file=sys.stderr),
            )
        except ImportStoppedError as error:
            print(error.message, file=sys.stderr)
            return 1
    print(printed(report))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
