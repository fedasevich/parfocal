from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from parfocal_api.private_cache import PrivateByDefault


def exports(_request: object) -> PlainTextResponse:
    return PlainTextResponse("id,class\nT1,tumour", media_type="text/csv")


def tile(_request: object) -> PlainTextResponse:
    return PlainTextResponse("tile", headers={"Cache-Control": "private, max-age=3600"})


def client() -> TestClient:
    app = Starlette(routes=[Route("/objects.csv", exports), Route("/tile", tile)])
    app.add_middleware(PrivateByDefault)
    return TestClient(app)


def test_an_answer_without_caching_rules_is_private_and_never_stored() -> None:
    response = client().get("/objects.csv")
    assert response.headers["cache-control"] == "private, no-store"
    assert response.text == "id,class\nT1,tumour"


def test_an_answer_that_sets_its_own_caching_keeps_it() -> None:
    assert client().get("/tile").headers["cache-control"] == "private, max-age=3600"
