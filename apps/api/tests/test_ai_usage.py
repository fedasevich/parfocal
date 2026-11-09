from collections.abc import Mapping
from typing import Any

import pytest
from db_support import ApiAs
from test_model_runs import DETECTOR, Lab, claim, execute, make_lab, ok, one_run, read
from workspace_support import owner

from parfocal_common.gpu_usage import ReportedSecondsError, report_gpu_seconds
from parfocal_common.jobs import StepPausedError, StepRun
from parfocal_common.model_runs import STAGES, workflow

pytestmark = pytest.mark.db

OTHER = {"name": "cellvit-sam", "version": "0.4.0"}


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database, admins=("owner",))


def metered_plan(reports: list[float], *, gpu: str = "L4", pause: bool = False) -> Any:
    async def quick(step: StepRun) -> Mapping[str, Any]:
        return {"units": 0}

    async def model(step: StepRun) -> Mapping[str, Any]:
        for seconds in reports:
            await report_gpu_seconds(step, seconds, gpu)
        if pause:
            raise StepPausedError("gpu-busy")
        return {"tiles": len(reports)}

    return workflow({name: model if name == "model-running" else quick for name in STAGES})


def usage_rows(database: str, job_id: str) -> list[tuple[object, ...]]:
    return owner(
        database,
        "SELECT tenant_id, kind, model, model_version, tier, gpu, worker, seconds "
        f"FROM gpu_usage WHERE job_id = '{job_id}' ORDER BY id",
    )


def usage(api: ApiAs, lab: Lab, query: str = "", who: str = "owner") -> Any:
    return api(lab.people[who]).get(f"/api/tenant/ai-usage{query}")


def test_the_worker_reports_gpu_seconds_per_tenant_job_and_model(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab, parameters={"detector": DETECTOR})
    execute(database, claim(database, lab, metered_plan([12.5, 3.25])))
    assert ok(read(api, lab, run))["status"] == "done"
    assert usage_rows(database, run["id"]) == [
        (
            lab.tenant,
            "model-run",
            DETECTOR["name"],
            DETECTOR["version"],
            None,
            "L4",
            "worker-1",
            12.5,
        ),
        (
            lab.tenant,
            "model-run",
            DETECTOR["name"],
            DETECTOR["version"],
            None,
            "L4",
            "worker-1",
            3.25,
        ),
    ]


def test_gpu_time_spent_before_a_pause_is_still_metered(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    execute(database, claim(database, lab, metered_plan([7.0], pause=True)))
    assert ok(read(api, lab, run))["status"] == "paused"
    assert [row[-1] for row in usage_rows(database, run["id"])] == [7.0]


def test_a_reported_time_outside_one_day_is_refused(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    with pytest.raises(ReportedSecondsError):
        execute(database, claim(database, lab, metered_plan([-1.0])))
    assert usage_rows(database, run["id"]) == []


def test_the_report_sums_gpu_seconds_per_model_and_job(api: ApiAs, database: str, lab: Lab) -> None:
    first = one_run(api, lab, parameters={"detector": DETECTOR})
    execute(database, claim(database, lab, metered_plan([10.0, 5.0])))
    second = one_run(api, lab, parameters={"detector": OTHER})
    execute(database, claim(database, lab, metered_plan([2.5])))
    report = ok(usage(api, lab))
    assert (report["gpu_seconds"], report["jobs"]) == (17.5, 2)
    assert [
        (m["model"], m["model_version"], m["gpu_seconds"], m["jobs"]) for m in report["models"]
    ] == [
        (DETECTOR["name"], DETECTOR["version"], 15.0, 1),
        (OTHER["name"], OTHER["version"], 2.5, 1),
    ]
    jobs = {job["job_id"]: job for job in report["recent_jobs"]}
    assert jobs[first["id"]]["gpu_seconds"] == 15.0
    assert jobs[first["id"]]["project_id"] == str(lab.project)
    assert jobs[first["id"]]["slide_id"] == first["slide_id"]
    assert jobs[second["id"]]["model"] == OTHER["name"]


def test_the_report_honours_its_range(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    execute(database, claim(database, lab, metered_plan([4.0, 6.0])))
    owner(
        database,
        "UPDATE gpu_usage SET recorded_at = '2026-01-10T00:00:00Z' "
        f"WHERE job_id = '{run['id']}' AND seconds = 4.0",
    )
    january = ok(usage(api, lab, "?since=2026-01-01T00:00:00Z&until=2026-02-01T00:00:00Z"))
    assert (january["gpu_seconds"], january["jobs"]) == (4.0, 1)
    later = ok(usage(api, lab, "?since=2026-02-01T00:00:00Z"))
    assert later["gpu_seconds"] == 6.0
    response = usage(api, lab, "?since=2026-02-01T00:00:00Z&until=2026-01-01T00:00:00Z")
    assert (response.status_code, response.json()["code"]) == (400, "usage-range-invalid")


def test_the_report_shows_only_this_workspace(api: ApiAs, database: str, lab: Lab) -> None:
    other = make_lab(api, database, admins=("owner",))
    one_run(api, other)
    execute(database, claim(database, other, metered_plan([9.0])))
    report = ok(usage(api, lab))
    assert (report["gpu_seconds"], report["jobs"], report["recent_jobs"]) == (0.0, 0, [])
    assert ok(usage(api, other))["gpu_seconds"] == 9.0


def test_reviewers_cannot_read_usage_and_researchers_only_view_it(
    api: ApiAs, database: str, lab: Lab
) -> None:
    assert usage(api, lab, who="viewer").status_code == 200
    assert usage(api, lab, who="reader").status_code == 403
