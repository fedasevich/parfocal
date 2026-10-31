import asyncio
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from test_annotations import make_class
from test_blinding import make_result_set
from workspace_support import join_project, make_project, make_slide, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.db import create_engine
from parfocal_common.jobs import (
    JobControl,
    JobStatus,
    JobStoppedError,
    StepFailedError,
    StepPausedError,
    StepRun,
    finish,
    move,
    run_job,
)
from parfocal_common.model_runs import (
    STAGES,
    ClaimedRun,
    RunScopeKind,
    claim_model_run,
    workflow,
)

pytestmark = pytest.mark.db

DETECTOR = {"name": "hovernet-pannuke", "version": "1.0.0"}
TYPER = {"name": "classify-nuclei", "version": "2026.10"}
SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [90, 0], [90, 90], [0, 90], [0, 0]]]}
BOWTIE = {"type": "Polygon", "coordinates": [[[0, 0], [90, 90], [90, 0], [0, 90], [0, 0]]]}


@dataclass(frozen=True)
class Lab:
    people: dict[str, MemberPrincipal]
    tenant: uuid.UUID
    project: uuid.UUID
    slides: list[uuid.UUID]
    task: uuid.UUID

    @property
    def runs(self) -> str:
        return f"/api/projects/{self.project}/model-runs"


def ok(response: Any) -> Any:
    assert 200 <= response.status_code < 300, response.text
    return response.json()


def problem(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def make_lab(api: ApiAs, database: str, *, hidden: bool = False) -> Lab:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "viewer": Role.RESEARCHER,
            "outsider": Role.RESEARCHER,
            "colleague": Role.RESEARCHER,
            "reader": Role.REVIEWER,
            "stranger": Role.REVIEWER,
        },
    )
    people, tenant = workspace.people, workspace.tenant_id
    project = make_project(database, tenant, "de-identified")
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["viewer"], "viewer")
    join_project(database, project, people["colleague"], "reviewer")
    join_project(database, project, people["reader"], "reviewer")
    join_project(database, project, people["stranger"], "reviewer")
    slides = [make_slide(database, tenant, project, f"Slide {uuid.uuid4().hex[:8]}") for _ in "abc"]
    make_class(database, tenant, project)
    result_set = make_result_set(database, tenant, project, slides[0])
    owner(
        database,
        "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
        f"VALUES ('{tenant}', '{slides[0]}', 'T', 2), ('{tenant}', '{slides[0]}', 'C', 5)",
    )
    task = ok(
        api(people["owner"]).post(
            f"/api/projects/{project}/review-tasks",
            json={
                "name": "Model run task",
                "slide_ids": [str(slides[0])],
                "result_sets": [{"slide_id": str(slides[0]), "result_set_id": result_set}],
                "reviewer_ids": [str(people["reader"].user_id)],
                "split": "everyone",
                "scope": {"kind": "all-regions"},
                "blinded": False,
                "ai_hidden_first_read": hidden,
            },
        )
    )["id"]
    return Lab(people, tenant, project, slides, uuid.UUID(task))


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


def body(slides: list[uuid.UUID], **changes: Any) -> dict[str, Any]:
    return {
        "slide_ids": [str(slide) for slide in slides],
        "scope": {"kind": "slide"},
        "parameters": {"detector": DETECTOR},
        **changes,
    }


def start(api: ApiAs, lab: Lab, slides: list[uuid.UUID] | None = None, **changes: Any) -> Any:
    return api(lab.people["owner"]).post(lab.runs, json=body(slides or lab.slides[:1], **changes))


def started(api: ApiAs, lab: Lab, slides: list[uuid.UUID] | None = None, **changes: Any) -> Any:
    response = start(api, lab, slides, **changes)
    assert response.status_code == 201, response.text
    return response.json()


def one_run(api: ApiAs, lab: Lab, **changes: Any) -> dict[str, Any]:
    return started(api, lab, **changes)[0]


def read(api: ApiAs, lab: Lab, run: Mapping[str, Any], who: str = "owner") -> Any:
    return api(lab.people[who]).get(f"{lab.runs}/{run['id']}")


def control(api: ApiAs, lab: Lab, run: Mapping[str, Any], action: str, who: str = "owner") -> Any:
    return api(lab.people[who]).post(f"{lab.runs}/{run['id']}/{action}")


def run_async[T](database: str, work_on: Callable[[Any], Awaitable[T]]) -> T:
    async def go() -> T:
        engine = create_engine(with_database(APP_URL, database))
        try:
            return await work_on(engine)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def claim(database: str, lab: Lab, plan: Any, worker: str = "worker-1") -> ClaimedRun:
    async def go(engine: Any) -> ClaimedRun:
        claimed = await claim_model_run(engine, worker, plan, lab.tenant)
        assert claimed is not None
        return claimed

    return run_async(database, go)


def execute(database: str, claimed: ClaimedRun, worker: str = "worker-1") -> None:
    async def go(engine: Any) -> None:
        await run_job(engine, claimed.job, claimed.workflow, worker)

    run_async(database, go)


@dataclass
class Tiles:
    total: int = 4
    fail_at: int | None = None
    pause_at: int | None = None
    cancel_at: int | None = None
    processed: list[int] = field(default_factory=list[int])

    def plan(self) -> Any:
        async def quick(step: StepRun) -> Mapping[str, Any]:
            await step.set_total(1)
            done = await step.done_units()
            async with step.transaction() as connection:
                if 0 not in done:
                    await step.mark_unit(connection, 0)
            return {"units": 1}

        async def model(step: StepRun) -> Mapping[str, Any]:
            await step.set_total(self.total)
            done = await step.done_units()
            for unit in range(self.total):
                if unit in done:
                    continue
                if unit == self.cancel_at:
                    self.cancel_at = None
                    async with step.transaction() as connection:
                        await move(connection, step.job_id, JobControl.CANCEL)
                if await step.should_stop():
                    raise JobStoppedError
                if unit == self.fail_at:
                    self.fail_at = None
                    raise StepFailedError("gpu-lost")
                if unit == self.pause_at:
                    self.pause_at = None
                    raise StepPausedError("lab-endpoint-unreachable")
                async with step.transaction() as connection:
                    await step.mark_unit(connection, unit)
                self.processed.append(unit)
            return {"tiles": self.total}

        return workflow({name: model if name == "model-running" else quick for name in STAGES})


def stage(run: Mapping[str, Any], name: str) -> dict[str, Any]:
    return next(item for item in run["stages"] if item["name"] == name)


def expire_lease(database: str, run: Mapping[str, Any]) -> None:
    owner(
        database,
        f"UPDATE jobs SET lease_until = now() - interval '1 second' WHERE id = '{run['id']}'",
    )


def test_starting_a_run_queues_one_job_per_slide_with_every_stage(
    api: ApiAs, database: str, lab: Lab
) -> None:
    runs = started(
        api,
        lab,
        lab.slides[:2],
        parameters={
            "detector": DETECTOR,
            "typer": TYPER,
            "test_time_views": 8,
            "ordering": "tumor-first",
        },
    )
    assert [run["slide_id"] for run in runs] == [str(slide) for slide in lab.slides[:2]]
    assert len({run["batch_id"] for run in runs}) == 1
    first = runs[0]
    assert first["status"] == "queued"
    assert first["scope"] == {"kind": "slide"}
    assert first["parameters"] == {
        "detector": DETECTOR,
        "typer": TYPER,
        "test_time_views": 8,
        "ordering": "tumor-first",
    }
    assert first["started_by_user_id"] == str(lab.people["owner"].user_id)
    assert first["actions"] == ["cancel"]
    assert [item["name"] for item in first["stages"]] == list(STAGES)
    assert {
        (item["status"], item["units_done"], item["units_total"]) for item in first["stages"]
    } == {("pending", 0, None)}
    actions = owner(
        database,
        "SELECT action, details FROM audit_events "
        f"WHERE target_type = 'model-run' AND target_id = '{first['id']}'",
    )
    assert [row[0] for row in actions] == ["model-run.started"]
    assert '"detector":"hovernet-pannuke@1.0.0"' in str(actions[0][1])
    listed = ok(api(lab.people["owner"]).get(lab.runs, params={"batch_id": first["batch_id"]}))
    assert {run["id"] for run in listed} == {run["id"] for run in runs}
    job = ok(api(lab.people["owner"]).get(f"/api/projects/{lab.project}/jobs/{first['id']}"))
    assert (job["kind"], job["status"]) == ("model-run", "queued")


def test_a_view_and_a_selection_are_stored_as_given(api: ApiAs, lab: Lab) -> None:
    view = {"kind": "view", "x": 100, "y": 200, "width": 512, "height": 256}
    assert one_run(api, lab, scope=view)["scope"] == view
    shape = {"kind": "selection", "geometry": SQUARE}
    assert one_run(api, lab, scope=shape)["scope"] == {**shape, "objects": None}
    picked = one_run(
        api, lab, scope={"kind": "selection", "objects": ["T2", "t2·c145", "C7", "T2"]}
    )
    assert picked["scope"] == {
        "kind": "selection",
        "geometry": None,
        "objects": ["T2", "T2.C145", "C7"],
    }


@pytest.mark.parametrize(
    "changes",
    [
        {"parameters": {"detector": DETECTOR, "temperature": 1.5}},
        {"parameters": {"detector": {**DETECTOR, "weights": "x"}}},
        {"parameters": {"detector": DETECTOR, "test_time_views": 8}},
        {"parameters": {"detector": DETECTOR, "typer": TYPER, "test_time_views": 4}},
        {"parameters": {"detector": DETECTOR, "typer": TYPER, "test_time_views": True}},
        {"parameters": {"detector": DETECTOR, "ordering": "random"}},
        {"parameters": {"detector": {"name": "hovernet"}}},
        {"parameters": {"detector": {"name": " ", "version": "1"}}},
        {"scope": {"kind": "slide", "x": 1}},
        {"scope": {"kind": "view", "x": 0, "y": 0, "width": 0, "height": 10}},
        {"scope": {"kind": "view", "x": "0", "y": 0, "width": 10, "height": 10}},
        {"scope": {"kind": "selection"}},
        {"scope": {"kind": "selection", "geometry": SQUARE, "objects": ["T1"]}},
        {"scope": {"kind": "selection", "objects": ["M1"]}},
        {"scope": {"kind": "selection", "objects": ["not an id"]}},
        {"scope": {"kind": "everything"}},
        {"priority": "high"},
    ],
)
def test_unknown_or_bad_parameters_are_refused(
    api: ApiAs, lab: Lab, changes: dict[str, Any]
) -> None:
    response = start(api, lab, **changes)
    assert problem(response) == (422, "validation")
    assert response.headers["content-type"].startswith("application/problem+json")


def test_slides_must_fit_the_scope_the_project_and_the_task(
    api: ApiAs, database: str, lab: Lab
) -> None:
    view = {"kind": "view", "x": 0, "y": 0, "width": 10, "height": 10}
    assert problem(start(api, lab, lab.slides[:2], scope=view)) == (422, "validation")
    assert problem(start(api, lab, [lab.slides[0], lab.slides[0]])) == (422, "validation")
    other = make_project(database, lab.tenant, "de-identified")
    elsewhere = make_slide(database, lab.tenant, other, "Elsewhere")
    assert problem(start(api, lab, [elsewhere])) == (400, "slide-not-in-project")
    in_task = start(api, lab, lab.slides[:1], task_id=str(lab.task))
    assert in_task.status_code == 201
    assert in_task.json()[0]["task_id"] == str(lab.task)
    assert problem(start(api, lab, lab.slides[1:2], task_id=str(lab.task))) == (
        400,
        "slide-not-in-task",
    )
    assert problem(start(api, lab, task_id=str(uuid.uuid4()))) == (400, "task-not-in-project")
    owner(database, f"UPDATE review_tasks SET archived_at = now() WHERE id = '{lab.task}'")
    assert problem(start(api, lab, task_id=str(lab.task))) == (409, "task-archived")
    bowtie = {"kind": "selection", "geometry": BOWTIE}
    assert problem(start(api, lab, scope=bowtie)) == (400, "selection-invalid")


def test_an_archived_project_starts_and_controls_nothing(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    owner(database, f"UPDATE projects SET archived_at = now() WHERE id = '{lab.project}'")
    assert problem(start(api, lab)) == (409, "project-archived")
    assert problem(control(api, lab, run, "cancel")) == (409, "project-archived")
    assert read(api, lab, run).json()["actions"] == []


def test_cancel_resume_and_retry_follow_the_state_machine(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    assert problem(control(api, lab, run, "resume")) == (409, "model-run-not-resumable")
    assert problem(control(api, lab, run, "retry")) == (409, "model-run-not-retryable")
    cancelled = ok(control(api, lab, run, "cancel"))
    assert (cancelled["status"], cancelled["actions"]) == ("cancelled", ["resume"])
    assert cancelled["finished_at"] is not None
    refused = control(api, lab, run, "cancel")
    assert problem(refused) == (409, "model-run-not-cancellable")
    assert refused.json()["detail"] == "The run is cancelled"
    resumed = ok(control(api, lab, run, "resume"))
    assert (resumed["status"], resumed["finished_at"]) == ("queued", None)
    actions = owner(
        database,
        "SELECT action FROM audit_events "
        f"WHERE target_type = 'model-run' AND target_id = '{run['id']}' ORDER BY seq",
    )
    assert [row[0] for row in actions] == [
        "model-run.started",
        "model-run.cancelled",
        "model-run.resumed",
    ]


def test_a_failed_run_keeps_its_finished_work_when_retried(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    tiles = Tiles(fail_at=2)
    plan = tiles.plan()
    claimed = claim(database, lab, plan)
    assert claimed.slide_id == lab.slides[0]
    assert claimed.settings.scope_kind is RunScopeKind.SLIDE
    assert claimed.settings.detector == DETECTOR["name"]
    execute(database, claimed)
    failed = ok(read(api, lab, run))
    assert (failed["status"], failed["error_code"], failed["actions"]) == (
        "failed",
        "gpu-lost",
        ["retry"],
    )
    model = stage(failed, "model-running")
    assert (model["status"], model["units_done"], model["units_total"]) == ("failed", 2, 4)
    assert stage(failed, "tiles-read")["status"] == "done"
    assert stage(failed, "ids-given")["status"] == "pending"
    retried = ok(control(api, lab, run, "retry"))
    assert (retried["status"], retried["error_code"]) == ("queued", None)
    assert stage(retried, "model-running")["status"] == "pending"
    assert stage(retried, "model-running")["units_done"] == 2
    execute(database, claim(database, lab, plan, "worker-2"), "worker-2")
    finished = ok(read(api, lab, run))
    assert (finished["status"], finished["attempts"], finished["actions"]) == ("done", 2, [])
    assert tiles.processed == [0, 1, 2, 3]
    assert stage(finished, "tiles-read")["runs"] == 1
    assert stage(finished, "model-running")["runs"] == 2
    assert {item["status"] for item in finished["stages"]} == {"done"}


def test_a_paused_run_says_why_and_resumes_where_it_stopped(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    tiles = Tiles(pause_at=3)
    plan = tiles.plan()
    execute(database, claim(database, lab, plan))
    paused = ok(read(api, lab, run))
    assert (paused["status"], paused["pause_reason"], paused["finished_at"]) == (
        "paused",
        "lab-endpoint-unreachable",
        None,
    )
    assert paused["actions"] == ["cancel", "resume"]
    assert stage(paused, "model-running")["status"] == "pending"
    assert problem(control(api, lab, run, "retry")) == (409, "model-run-not-retryable")
    assert ok(control(api, lab, run, "resume"))["pause_reason"] is None
    execute(database, claim(database, lab, plan))
    assert ok(read(api, lab, run))["status"] == "done"
    assert tiles.processed == [0, 1, 2, 3]


def test_cancelling_a_running_run_waits_for_the_worker_to_stop(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    claimed = claim(database, lab, Tiles().plan())
    assert ok(read(api, lab, run))["status"] == "running"
    cancelling = ok(control(api, lab, run, "cancel"))
    assert (cancelling["status"], cancelling["actions"]) == ("cancelling", [])
    assert cancelling["finished_at"] is None
    assert problem(control(api, lab, run, "resume")) == (409, "model-run-not-resumable")
    execute(database, claimed)
    cancelled = ok(read(api, lab, run))
    assert (cancelled["status"], cancelled["actions"]) == ("cancelled", ["resume"])
    assert {item["status"] for item in cancelled["stages"]} == {"pending"}


def test_a_cancel_in_the_middle_of_a_stage_keeps_the_finished_tiles(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    tiles = Tiles(cancel_at=1)
    plan = tiles.plan()
    execute(database, claim(database, lab, plan))
    cancelled = ok(read(api, lab, run))
    assert cancelled["status"] == "cancelled"
    model = stage(cancelled, "model-running")
    assert (model["status"], model["units_done"], model["units_total"]) == ("pending", 1, 4)
    assert stage(cancelled, "tiles-read")["status"] == "done"
    ok(control(api, lab, run, "resume"))
    execute(database, claim(database, lab, plan))
    assert ok(read(api, lab, run))["status"] == "done"
    assert tiles.processed == [0, 1, 2, 3]


def test_a_cancel_after_the_worker_died_ends_at_once(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    claim(database, lab, Tiles().plan())
    expire_lease(database, run)
    assert ok(control(api, lab, run, "cancel"))["status"] == "cancelled"


def test_a_cancel_whose_worker_dies_is_settled_by_the_next_claim(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    claim(database, lab, Tiles().plan())
    assert ok(control(api, lab, run, "cancel"))["status"] == "cancelling"
    expire_lease(database, run)

    async def go(engine: Any) -> ClaimedRun | None:
        return await claim_model_run(engine, "worker-2", Tiles().plan(), lab.tenant)

    assert run_async(database, go) is None
    assert ok(read(api, lab, run))["status"] == "cancelled"


def test_a_worker_that_lost_its_lease_cannot_end_the_run(
    api: ApiAs, database: str, lab: Lab
) -> None:
    run = one_run(api, lab)
    plan = Tiles().plan()
    first = claim(database, lab, plan, "worker-1")
    expire_lease(database, run)
    second = claim(database, lab, plan, "worker-2")
    assert second.job.job_id == first.job.job_id

    async def go(engine: Any) -> JobStatus | None:
        return await finish(engine, first.job, "worker-1", JobStatus.DONE)

    assert run_async(database, go) is None
    assert ok(read(api, lab, run))["status"] == "running"
    execute(database, second, "worker-2")
    assert ok(read(api, lab, run))["status"] == "done"


def test_a_worker_must_give_every_stage() -> None:
    with pytest.raises(ValueError, match="stages"):
        workflow({"tiles-read": Tiles().plan().steps[0].run})


def test_only_owners_start_and_control_runs(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    for who in ("reader", "stranger"):
        assert problem(start_as(api, lab, who)) == (403, "forbidden")
        assert problem(control(api, lab, run, "cancel", who)) == (403, "forbidden")
    for who in ("viewer", "colleague"):
        assert problem(start_as(api, lab, who)) == (403, "running-models-not-allowed")
    refused = control(api, lab, run, "cancel", "viewer")
    assert problem(refused) == (403, "running-models-not-allowed")
    assert problem(control(api, lab, run, "cancel", "colleague")) == (404, "not-found")
    assert problem(start_as(api, lab, "outsider")) == (404, "not-found")
    assert problem(control(api, lab, run, "cancel", "outsider")) == (404, "not-found")
    assert ok(read(api, lab, run, "viewer"))["actions"] == []
    assert ok(read(api, lab, run))["status"] == "queued"


def start_as(api: ApiAs, lab: Lab, who: str) -> Any:
    return api(lab.people[who]).post(lab.runs, json=body(lab.slides[:1]))


def listed(api: ApiAs, lab: Lab, who: str) -> set[str]:
    return {run["id"] for run in ok(api(lab.people[who]).get(lab.runs))}


def test_reviewers_see_only_the_runs_on_their_task_slides(api: ApiAs, lab: Lab) -> None:
    mine, other = started(api, lab, lab.slides[:2])
    assert listed(api, lab, "owner") == {mine["id"], other["id"]}
    assert listed(api, lab, "viewer") == {mine["id"], other["id"]}
    assert listed(api, lab, "reader") == {mine["id"]}
    assert listed(api, lab, "stranger") == set()
    assert ok(read(api, lab, mine, "reader"))["actions"] == []
    assert read(api, lab, other, "reader").status_code == 404
    assert read(api, lab, mine, "stranger").status_code == 404
    assert read(api, lab, mine, "outsider").status_code == 404
    job = api(lab.people["stranger"]).get(f"/api/projects/{lab.project}/jobs/{mine['id']}")
    assert job.status_code == 404


def test_a_reviewer_whose_first_read_is_open_sees_no_run(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database, hidden=True)
    run = one_run(api, lab)
    assert listed(api, lab, "reader") == set()
    assert read(api, lab, run, "reader").status_code == 404
    base = f"/api/review-tasks/{lab.task}/slides/{lab.slides[0]}"
    ok(api(lab.people["reader"]).post(f"{base}/first-read"))
    assert listed(api, lab, "reader") == {run["id"]}


def test_lists_filter_by_status_slide_and_task(api: ApiAs, lab: Lab) -> None:
    first, second = started(api, lab, lab.slides[:2])
    ok(control(api, lab, second, "cancel"))
    by_status = api(lab.people["owner"]).get(lab.runs, params={"status": ["cancelled"]})
    assert [run["id"] for run in ok(by_status)] == [second["id"]]
    by_slide = api(lab.people["owner"]).get(lab.runs, params={"slide_id": str(lab.slides[0])})
    assert [run["id"] for run in ok(by_slide)] == [first["id"]]
    tasked = one_run(api, lab, task_id=str(lab.task))
    by_task = api(lab.people["owner"]).get(lab.runs, params={"task_id": str(lab.task)})
    assert [run["id"] for run in ok(by_task)] == [tasked["id"]]
    newest = api(lab.people["owner"]).get(lab.runs, params={"limit": 1})
    assert [run["id"] for run in ok(newest)] == [tasked["id"]]


def test_another_workspace_sees_and_controls_nothing(api: ApiAs, database: str, lab: Lab) -> None:
    run = one_run(api, lab)
    other = make_lab(api, database)
    stranger = other.people["owner"]
    assert api(stranger).get(f"{lab.runs}/{run['id']}").status_code == 404
    assert api(stranger).post(f"{lab.runs}/{run['id']}/cancel").status_code == 404
    assert api(stranger).get(f"{other.runs}/{run['id']}").status_code == 404
    assert api(stranger).post(f"{other.runs}/{run['id']}/cancel").status_code == 404
    assert ok(read(api, lab, run))["status"] == "queued"
