import pytest
from db_support import ApiAs
from workspace_support import make_workspace

from parfocal_api.tables import Role

pytestmark = pytest.mark.db

PROJECTS = "/api/projects"
BASE = ["objects", "layers", "decisions", "opinion"]
PARTS = {
    "none": BASE,
    "sentinel-node": [*BASE, "staging-hero", "area-list", "measure-step"],
    "cell-review": [*BASE, "unsure-zones", "cell-typing"],
}


@pytest.mark.parametrize("template", sorted(PARTS))
def test_each_template_decides_which_viewer_parts_show(
    api: ApiAs, database: str, template: str
) -> None:
    owner = make_workspace(database, {"owner": Role.RESEARCHER}).people["owner"]
    created = api(owner).post(PROJECTS, json={"name": "Nodes", "template": template})
    assert created.status_code == 201, created.text
    project = created.json()
    assert (project["template"], project["viewer_parts"]) == (template, PARTS[template])
    read = api(owner).get(f"{PROJECTS}/{project['id']}").json()
    assert read["viewer_parts"] == PARTS[template]
    listed = api(owner).get(PROJECTS).json()
    assert [row["viewer_parts"] for row in listed] == [PARTS[template]]


def test_a_project_without_a_template_shows_only_the_generic_parts(
    api: ApiAs, database: str
) -> None:
    owner = make_workspace(database, {"owner": Role.RESEARCHER}).people["owner"]
    project = api(owner).post(PROJECTS, json={"name": "Colon"}).json()
    assert (project["template"], project["viewer_parts"]) == ("none", BASE)


@pytest.mark.parametrize(
    ("before", "after"),
    [("none", "sentinel-node"), ("sentinel-node", "cell-review"), ("cell-review", "none")],
)
def test_changing_the_template_changes_the_viewer_parts(
    api: ApiAs, database: str, before: str, after: str
) -> None:
    owner = make_workspace(database, {"owner": Role.RESEARCHER}).people["owner"]
    project = api(owner).post(PROJECTS, json={"name": "Nodes", "template": before}).json()
    changed = api(owner).patch(f"{PROJECTS}/{project['id']}", json={"template": after})
    assert changed.status_code == 200, changed.text
    assert changed.json()["viewer_parts"] == PARTS[after]
    assert api(owner).get(f"{PROJECTS}/{project['id']}").json()["viewer_parts"] == PARTS[after]
