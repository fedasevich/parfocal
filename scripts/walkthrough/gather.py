from typing import Any

from walkthrough.client import Client
from walkthrough.resolve import (
    Seed,
    add_cases,
    add_projects,
    add_single,
    add_slides,
    add_task_slides,
    add_tasks,
)


def first(items: Any, key: str = "id") -> object:
    rows = items if isinstance(items, list) else []
    return rows[0].get(key) if rows and isinstance(rows[0], dict) else None


def answered(client: Client, path: str) -> Any:
    answer = client.send(path)
    return answer.json() if answer.status == 200 else None


def project_seed(seed: Seed, owner: Client) -> None:
    projects = owner.json("/api/projects")
    add_projects(seed, projects)
    for project in projects:
        project_id = project["id"]
        tasks = answered(owner, f"/api/projects/{project_id}/review-tasks") or []
        add_tasks(seed, project_id, tasks)
        for task in tasks:
            states = answered(owner, f"/api/review-tasks/{task['id']}/states")
            if states and str(task["name"]) not in seed.task_slides:
                add_task_slides(seed, str(task["name"]), states)
        add_slides(
            seed, str(project["name"]), answered(owner, f"/api/projects/{project_id}/slides") or []
        )
        runs = answered(owner, f"/api/projects/{project_id}/model-runs") or []
        if runs:
            add_single(seed, "run", first(runs))
            add_single(seed, "run_project", project_id)


def personal_seed(seed: Seed, owner: Client, roles: dict[str, Client]) -> None:
    add_cases(seed, answered(owner, "/api/cases") or [])
    jobs = answered(owner, "/api/me/jobs") or []
    add_single(seed, "job", first(jobs))
    if jobs and isinstance(jobs[0].get("project"), dict):
        add_single(seed, "job_project", jobs[0]["project"].get("id"))
    notes = answered(owner, "/api/me/notifications") or {}
    add_single(seed, "notification", first(notes.get("notifications", [])))
    for role, client in roles.items():
        notes = answered(client, "/api/me/notifications") or {}
        add_single(seed, f"notification:{role}", first(notes.get("notifications", [])))
        adjudications = answered(client, "/api/adjudications") or []
        if adjudications:
            item = adjudications[0]
            add_single(seed, f"adj_task:{role}", item.get("task_id"))
            add_single(seed, f"adj_slide:{role}", item.get("slide_id"))
            objects = item.get("objects") or []
            add_single(seed, f"adj_object:{role}", objects[0] if objects else None)
        work = answered(client, "/api/me/review-tasks") or []
        if work:
            add_single(seed, f"my_task:{role}", work[0].get("id"))
            add_single(seed, f"my_slide:{role}", work[0].get("next_slide_id"))
            project = work[0].get("project")
            add_single(
                seed, f"my_project:{role}", project.get("id") if isinstance(project, dict) else None
            )


def gather(owner: Client, roles: dict[str, Client], workspace: str) -> Seed:
    seed = Seed(workspace=workspace)
    project_seed(seed, owner)
    personal_seed(seed, owner, roles)
    return seed
