import asyncio
import json
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import httpx2
import pytest
from db_support import ApiAs, api_settings
from idp_support import signed_in_browser
from workspace_support import make_workspace

from parfocal_api.app import create_app
from parfocal_api.tables import Role

pytestmark = pytest.mark.db


BUSY_SESSION = json.loads(
    (Path(__file__).parent / "fixtures" / "busy-viewer-session.json").read_text()
)
FLOOD_PAST_THE_LIMIT = 50


def away_from_the_minute_edge(needed: int = 10) -> None:
    second = datetime.now(UTC).second
    if second >= 60 - needed:
        time.sleep(61 - second)


def service_token(api: ApiAs, database: str) -> tuple[str, str]:
    w = make_workspace(database, {"admin": Role.RESEARCHER}, admins={"admin"})
    tokens: list[str] = []
    for name in ("Pipeline A", "Pipeline B"):
        created = api(w.people["admin"]).post(
            "/api/tenant/service-accounts", json={"name": name, "scopes": ["see-people"]}
        )
        assert created.status_code == 201, created.text
        tokens.append(created.json()["token"]["token"])
    return tokens[0], tokens[1]


async def burst(database: str, token: str, count: int, **limits: int) -> list[httpx2.Response]:
    app = create_app(api_settings(database).model_copy(update=limits))
    try:
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="https://testserver"
        ) as client:
            return list(
                await asyncio.gather(
                    *(
                        client.get("/api/tenant", headers={"authorization": f"Bearer {token}"})
                        for _ in range(count)
                    )
                )
            )
    finally:
        await app.state.engine.dispose()


def test_a_concurrent_burst_past_the_limit_gets_429_with_retry_after(
    api: ApiAs, database: str
) -> None:
    token, _ = service_token(api, database)
    away_from_the_minute_edge()
    responses = asyncio.run(
        burst(
            database, token, 30, rate_limit_person_per_minute=10, rate_limit_tenant_per_minute=1000
        )
    )
    assert Counter(response.status_code for response in responses) == {200: 10, 429: 20}
    refused = [response for response in responses if response.status_code == 429]
    assert {response.json()["code"] for response in refused} == {"rate-limited"}
    assert all(1 <= int(response.headers["retry-after"]) <= 60 for response in refused)
    assert {response.headers["content-type"] for response in refused} == {
        "application/problem+json"
    }


def test_the_tenant_limit_is_shared_by_everyone_in_the_workspace(api: ApiAs, database: str) -> None:
    first, second = service_token(api, database)
    away_from_the_minute_edge()
    limits = {"rate_limit_person_per_minute": 100, "rate_limit_tenant_per_minute": 6}
    assert [r.status_code for r in asyncio.run(burst(database, first, 4, **limits))] == [200] * 4
    from_second = sorted(r.status_code for r in asyncio.run(burst(database, second, 3, **limits)))
    assert from_second == [200, 200, 429]
    assert [r.status_code for r in asyncio.run(burst(database, first, 1, **limits))] == [429]


def test_a_signed_in_person_is_limited_too(database: str) -> None:
    away_from_the_minute_edge()
    with signed_in_browser(database, rate_limit_person_per_minute=3) as browser:
        browser.login()
        codes = [browser.client.get("/api/me").status_code for _ in range(4)]
        assert codes == [200, 200, 200, 429]
        assert browser.client.get("/api/health").status_code == 200


async def replay_then_flood(database: str, token: str) -> tuple[Counter[int], Counter[int]]:
    settings = api_settings(database)
    busiest = max(BUSY_SESSION["busiest_minutes"])
    flood = settings.rate_limit_person_per_minute - busiest + FLOOD_PAST_THE_LIMIT
    app = create_app(settings)
    headers = {"authorization": f"Bearer {token}"}
    try:
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="https://testserver"
        ) as client:

            async def send(count: int) -> Counter[int]:
                codes: Counter[int] = Counter()
                for start in range(0, count, 25):
                    replies = await asyncio.gather(
                        *(
                            client.get("/api/tenant", headers=headers)
                            for _ in range(min(25, count - start))
                        )
                    )
                    codes.update(reply.status_code for reply in replies)
                return codes

            return await send(busiest), await send(flood)
    finally:
        await app.state.engine.dispose()


def test_a_recorded_busy_session_stays_under_the_default_limit_and_a_flood_does_not(
    api: ApiAs, database: str
) -> None:
    token, _ = service_token(api, database)
    away_from_the_minute_edge(needed=20)
    started = time.monotonic()
    session, flood = asyncio.run(replay_then_flood(database, token))
    assert time.monotonic() - started < 20
    assert session == {200: max(BUSY_SESSION["busiest_minutes"])}
    assert flood[429] == FLOOD_PAST_THE_LIMIT


def test_the_default_limit_leaves_room_above_the_busiest_recorded_minute(database: str) -> None:
    settings = api_settings(database)
    busiest = max(BUSY_SESSION["busiest_minutes"])
    assert settings.rate_limit_person_per_minute >= 2 * busiest
    assert settings.rate_limit_tenant_per_minute >= 4 * settings.rate_limit_person_per_minute
