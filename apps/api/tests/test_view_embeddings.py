import uuid
from collections.abc import Generator

import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab, problem
from workspace_support import owner

from parfocal_api.principals import ServicePrincipal
from parfocal_common.embedding_cache import EMBEDDING_BYTES
from parfocal_common.view_embeddings import (
    ENCODER,
    MAX_VIEW_SIDE,
    reply_of,
    view_embedding_call_of,
)
from parfocal_common.view_maps import timed
from parfocal_common.warm_gate import EMBEDDER_FUNCTION, WarmGate

pytestmark = pytest.mark.db

WIDTH, HEIGHT = 8192, 6144
VIEW = {"x": 1024, "y": 2048, "width": 512, "height": 512}
EMBEDDING = bytes(range(256)) * (EMBEDDING_BYTES // 256)


class FakeEncoder:
    def __init__(self, seconds: float | None = None) -> None:
        self.seconds = seconds
        self.calls: list[tuple[str, dict[str, object]]] = []

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.calls.append((function_name, call))

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        self.calls.append((function_name, call))
        view_embedding_call_of(call)
        reply = reply_of(EMBEDDING)
        return reply if self.seconds is None else timed(reply, self.seconds)


class ShortEncoder(FakeEncoder):
    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return reply_of(EMBEDDING[:100])


class OtherEncoder(FakeEncoder):
    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return {"embedding": EMBEDDING, "encoder": "pathosam-vit-b-histopathology-fp32"}


class BrokenEncoder(FakeEncoder):
    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        raise ConnectionError("no container")


def sized(database: str, lab: Lab) -> Lab:
    for slide in lab.slides:
        owner(
            database,
            f"UPDATE slides SET width = {WIDTH}, height = {HEIGHT} WHERE id = '{slide}' "
            "RETURNING id",
        )
    return lab


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return sized(database, make_lab(api, database))


@pytest.fixture
def encoder(api: ApiAs) -> Generator[FakeEncoder]:
    fake = FakeEncoder()
    api.app.state.warm_gate = WarmGate(fake)
    try:
        yield fake
    finally:
        del api.app.state.warm_gate


def ask(api: ApiAs, lab: Lab, view: dict[str, int] | None = None, who: str = "owner"):
    path = f"/api/slides/{lab.slides[0]}/embeddings/view"
    return api(lab.people[who]).post(path, json=VIEW if view is None else view)


def test_a_view_comes_back_as_the_vit_l_embedding_and_is_audited(
    api: ApiAs, database: str, lab: Lab, encoder: FakeEncoder
) -> None:
    response = ask(api, lab)
    assert response.status_code == 200, response.text
    assert response.content == EMBEDDING
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["parfocal-encoder"] == ENCODER
    assert response.headers["cache-control"] == "no-store"
    name, call = encoder.calls[0]
    assert name == EMBEDDER_FUNCTION
    assert call["kind"] == "view-embedding"
    assert call["tenant_id"] == str(lab.tenant)
    assert call["slide_id"] == str(lab.slides[0])
    assert {key: call[key] for key in VIEW} == VIEW
    rows = owner(
        database,
        "SELECT details::jsonb->>'encoder' FROM audit_events "
        f"WHERE action = 'view.embedded' AND target_id = '{lab.slides[0]}'",
    )
    assert rows == [("pathosam-vit-l-encoder@v1",)]


def test_the_encoder_is_sent_the_folder_beside_the_slide_original(
    api: ApiAs, database: str, lab: Lab, encoder: FakeEncoder
) -> None:
    assert ask(api, lab).status_code == 200
    owner(
        database,
        "UPDATE slides SET original_key = 'samples/camelyon16/test_065/original.tif' "
        f"WHERE id = '{lab.slides[0]}' RETURNING id",
    )
    assert ask(api, lab).status_code == 200
    assert [call.get("folder") for _, call in encoder.calls] == [
        None,
        "samples/camelyon16/test_065/",
    ]


def test_a_view_that_is_too_large_or_past_the_slide_is_refused(
    api: ApiAs, database: str, lab: Lab, encoder: FakeEncoder
) -> None:
    assert ask(api, lab, {**VIEW, "width": MAX_VIEW_SIDE + 1}).status_code == 422
    assert ask(api, lab, {**VIEW, "height": 8}).status_code == 422
    assert ask(api, lab, {**VIEW, "x": -1}).status_code == 422
    assert problem(ask(api, lab, {**VIEW, "x": WIDTH - 100})) == (404, "view-outside")
    assert problem(ask(api, lab, {**VIEW, "y": HEIGHT - 511})) == (404, "view-outside")
    owner(
        database,
        f"UPDATE slides SET width = NULL, height = NULL WHERE id = '{lab.slides[0]}' RETURNING id",
    )
    assert problem(ask(api, lab)) == (404, "view-outside")
    assert encoder.calls == []


def test_anyone_who_can_read_the_slide_may_ask(
    api: ApiAs, database: str, lab: Lab, encoder: FakeEncoder
) -> None:
    assert ask(api, lab, who="reader").status_code == 200
    assert ask(api, lab, who="viewer").status_code == 200
    assert len(encoder.calls) == 2
    assert ask(api, lab, who="stranger").status_code == 404
    assert ask(api, lab, who="outsider").status_code == 404
    other = sized(database, make_lab(api, database))
    refused = api(lab.people["owner"]).post(
        f"/api/slides/{other.slides[0]}/embeddings/view", json=VIEW
    )
    assert refused.status_code == 404, refused.text
    assert len(encoder.calls) == 2


def test_a_person_without_read_access_is_forbidden(
    api: ApiAs, lab: Lab, encoder: FakeEncoder
) -> None:
    for scopes in (frozenset[str](), frozenset({"see-people"})):
        service = ServicePrincipal(uuid.uuid4(), lab.tenant, scopes)
        refused = api(service).post(f"/api/slides/{lab.slides[0]}/embeddings/view", json=VIEW)
        assert refused.status_code == 403, refused.text
    assert encoder.calls == []


def test_a_reviewer_whose_ai_is_hidden_gets_no_embedding(
    api: ApiAs, database: str, encoder: FakeEncoder
) -> None:
    hidden = sized(database, make_lab(api, database, hidden=True))
    assert ask(api, hidden, who="reader").status_code == 404
    assert encoder.calls == []


def test_the_gpu_seconds_land_on_the_person_who_asked(api: ApiAs, database: str, lab: Lab) -> None:
    api.app.state.warm_gate = WarmGate(FakeEncoder(seconds=0.75))
    try:
        assert ask(api, lab, who="reader").status_code == 200
    finally:
        del api.app.state.warm_gate
    rows = owner(
        database,
        "SELECT (details::jsonb->>'gpu_seconds')::float FROM audit_events "
        f"WHERE action = 'view.embedded' AND target_id = '{lab.slides[0]}'",
    )
    assert rows == [(0.75,)]


@pytest.mark.parametrize(
    "pools",
    [None, ShortEncoder(), OtherEncoder(), BrokenEncoder()],
    ids=["none", "short", "other-encoder", "broken"],
)
def test_no_answering_encoder_is_a_503(api: ApiAs, lab: Lab, pools: FakeEncoder | None) -> None:
    if pools is not None:
        api.app.state.warm_gate = WarmGate(pools)
    try:
        assert problem(ask(api, lab)) == (503, "encoder-offline")
    finally:
        if pools is not None:
            del api.app.state.warm_gate
