import uuid
from collections.abc import Generator

import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab, problem
from workspace_support import owner

from parfocal_api.model_registry import temperatures_of
from parfocal_api.principals import ServicePrincipal
from parfocal_common.outline_types import TYPER, TYPER_VERSION, outline_types_call_of
from parfocal_common.view_maps import timed
from parfocal_common.warm_gate import EMBEDDER_FUNCTION, WarmGate

pytestmark = pytest.mark.db

SQUARE = [100.0, 100.0, 120.0, 100.0, 120.0, 120.0, 100.0, 120.0]


def typed_as(name: str) -> dict[str, object]:
    shares: dict[str, float] = dict.fromkeys(("tumor", "stroma", "immune", "other"), 0.1)
    shares[name] = 0.7
    return {"probabilities": shares, "type": name, "alternatives": [], "foreground": 0.9}


class FakeTyper:
    def __init__(self, seconds: float | None = None) -> None:
        self.seconds = seconds
        self.calls: list[tuple[str, dict[str, object]]] = []

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.calls.append((function_name, call))

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        self.calls.append((function_name, call))
        request = outline_types_call_of(call)
        reply: dict[str, object] = {
            "outlines": [
                typed_as("tumor" if points[0] < 1000 else "immune") for points in request.outlines
            ]
        }
        return reply if self.seconds is None else timed(reply, self.seconds)


class ShortTyper(FakeTyper):
    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return {"outlines": []}


class BrokenTyper(FakeTyper):
    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        raise ConnectionError("no container")


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


@pytest.fixture
def typer(api: ApiAs) -> Generator[FakeTyper]:
    fake = FakeTyper()
    api.app.state.warm_gate = WarmGate(fake)
    try:
        yield fake
    finally:
        del api.app.state.warm_gate


def ask(api: ApiAs, lab: Lab, outlines: list[list[float]], who: str = "owner", slide: int = 0):
    body = {"outlines": [{"points": points} for points in outlines]}
    return api(lab.people[who]).post(f"/api/slides/{lab.slides[slide]}/outline-types", json=body)


def shifted(dx: float) -> list[float]:
    return [value + dx if index % 2 == 0 else value for index, value in enumerate(SQUARE)]


def test_each_outline_comes_back_typed_and_calibrated_in_order(
    api: ApiAs, database: str, lab: Lab, typer: FakeTyper
) -> None:
    response = ask(api, lab, [SQUARE, shifted(2000), SQUARE])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["slide_id"] == str(lab.slides[0])
    assert (body["typer"], body["version"], body["calibrated"]) == (TYPER, TYPER_VERSION, True)
    assert [outline["type"] for outline in body["outlines"]] == ["tumor", "immune", "tumor"]
    name, call = typer.calls[0]
    assert name == EMBEDDER_FUNCTION
    assert call["kind"] == "outline-types"
    assert call["tenant_id"] == str(lab.tenant)
    assert call["slide_id"] == str(lab.slides[0])
    assert call["outlines"] == [SQUARE, shifted(2000), SQUARE]
    assert call["temperature"] == temperatures_of(TYPER, TYPER_VERSION)[1]
    rows = owner(
        database,
        "SELECT (details::jsonb->>'outlines')::int, details::text LIKE '%100%' FROM audit_events "
        f"WHERE action = 'outlines.typed' AND target_id = '{lab.slides[0]}'",
    )
    assert rows == [(3, False)]


def test_the_typer_is_sent_the_folder_beside_the_slide_original(
    api: ApiAs, database: str, lab: Lab, typer: FakeTyper
) -> None:
    owner(
        database,
        f"UPDATE slides SET original_key = NULL WHERE id = '{lab.slides[0]}' RETURNING id",
    )
    assert ask(api, lab, [SQUARE]).status_code == 200
    owner(
        database,
        "UPDATE slides SET original_key = 'samples/camelyon16/test_065/original.tif' "
        f"WHERE id = '{lab.slides[0]}' RETURNING id",
    )
    assert ask(api, lab, [SQUARE]).status_code == 200
    assert [call.get("folder") for _, call in typer.calls] == [
        None,
        "samples/camelyon16/test_065/",
    ]


def test_outlines_that_are_not_small_closed_rings_are_refused(
    api: ApiAs, lab: Lab, typer: FakeTyper
) -> None:
    assert ask(api, lab, []).status_code == 422
    assert ask(api, lab, [SQUARE[:5]]).status_code == 422
    assert ask(api, lab, [[0, 0, 600, 0, 600, 600]]).status_code == 422
    assert ask(api, lab, [SQUARE] * 501).status_code == 422
    assert typer.calls == []


def test_anyone_who_can_read_the_slide_may_ask(
    api: ApiAs, database: str, lab: Lab, typer: FakeTyper
) -> None:
    assert ask(api, lab, [SQUARE], who="reader").status_code == 200
    assert ask(api, lab, [SQUARE], who="viewer").status_code == 200
    assert len(typer.calls) == 2
    assert ask(api, lab, [SQUARE], who="stranger").status_code == 404
    assert ask(api, lab, [SQUARE], who="outsider").status_code == 404
    other = make_lab(api, database)
    refused = api(lab.people["owner"]).post(
        f"/api/slides/{other.slides[0]}/outline-types", json={"outlines": [{"points": SQUARE}]}
    )
    assert refused.status_code == 404, refused.text
    assert len(typer.calls) == 2


def test_a_person_without_read_access_is_forbidden(api: ApiAs, lab: Lab, typer: FakeTyper) -> None:
    for scopes in (frozenset[str](), frozenset({"see-people"})):
        service = ServicePrincipal(uuid.uuid4(), lab.tenant, scopes)
        refused = api(service).post(
            f"/api/slides/{lab.slides[0]}/outline-types", json={"outlines": [{"points": SQUARE}]}
        )
        assert refused.status_code == 403, refused.text
    assert typer.calls == []


def test_a_reviewer_whose_ai_is_hidden_cannot_type_outlines(
    api: ApiAs, database: str, typer: FakeTyper
) -> None:
    hidden = make_lab(api, database, hidden=True)
    assert ask(api, hidden, [SQUARE], who="reader").status_code == 404
    assert typer.calls == []


def test_the_gpu_seconds_land_on_the_person_who_asked(api: ApiAs, database: str, lab: Lab) -> None:
    api.app.state.warm_gate = WarmGate(FakeTyper(seconds=0.75))
    try:
        assert ask(api, lab, [SQUARE], who="reader").status_code == 200
    finally:
        del api.app.state.warm_gate
    rows = owner(
        database,
        "SELECT (details::jsonb->>'gpu_seconds')::float FROM audit_events "
        f"WHERE action = 'outlines.typed' AND target_id = '{lab.slides[0]}'",
    )
    assert rows == [(0.75,)]


@pytest.mark.parametrize(
    "pools", [None, ShortTyper(), BrokenTyper()], ids=["none", "short", "broken"]
)
def test_no_answering_typer_is_a_503(api: ApiAs, lab: Lab, pools: FakeTyper | None) -> None:
    if pools is not None:
        api.app.state.warm_gate = WarmGate(pools)
    try:
        assert problem(ask(api, lab, [SQUARE])) == (503, "typer-offline")
    finally:
        if pools is not None:
            del api.app.state.warm_gate
