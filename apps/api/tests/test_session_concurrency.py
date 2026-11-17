import asyncio
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from idp_support import Browser

from parfocal_api import auth

pytestmark = pytest.mark.db

DATABASE_ROUND_TRIPS = 0.5
CALLS = 20


@pytest.fixture
def slow_database(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve = auth.resolve

    async def far_away_resolve(
        connection: Any, subject: str, active_tenant_id: uuid.UUID | None
    ) -> auth.Resolved:
        await asyncio.sleep(DATABASE_ROUND_TRIPS)
        return await resolve(connection, subject, active_tenant_id)

    monkeypatch.setattr(auth, "resolve", far_away_resolve)


def timed_calls(browser: Browser, count: int) -> tuple[float, list[int]]:
    def call(_: int) -> int:
        return browser.session().status_code

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=count) as pool:
        codes = list(pool.map(call, range(count)))
    return time.perf_counter() - started, codes


def test_calls_of_one_session_do_not_wait_on_each_other(
    browser: Browser, slow_database: None
) -> None:
    browser.login()
    timed_calls(browser, CALLS)
    one, single = timed_calls(browser, 1)
    many, codes = timed_calls(browser, CALLS)
    print(f"one call {one:.3f} s, {CALLS} parallel calls {many:.3f} s")
    assert single == [200]
    assert codes == [200] * CALLS
    assert many < 3 * one


def test_racing_calls_near_expiry_refresh_the_tokens_once(
    browser: Browser, slow_database: None
) -> None:
    browser.idp.expires_in = 0
    browser.login()
    browser.idp.expires_in = 3600
    _, codes = timed_calls(browser, 5)
    assert codes == [200] * 5
    assert browser.idp.refreshes == 1
    assert len(browser.idp.refresh_tokens) == 1
