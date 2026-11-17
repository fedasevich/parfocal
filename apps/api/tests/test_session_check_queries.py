import re

import httpx2
import pytest
from idp_support import Browser
from test_rate_limits import away_from_the_minute_edge
from test_second_factor import PASSWORD_ONLY, enter, new_workspace, sign_in

from parfocal_api.rate_limits import BatchedCounts, flush_chunk

pytestmark = pytest.mark.db

TIMING = re.compile(r'queries;desc="(\d+)", transactions;desc="(\d+)"')


def shape(response: httpx2.Response) -> tuple[int, int]:
    found = TIMING.search(response.headers["server-timing"])
    assert found is not None
    return int(found[1]), int(found[2])


def test_a_warm_check_in_a_one_factor_workspace_reads_the_session_in_one_statement(
    browser: Browser,
) -> None:
    away_from_the_minute_edge()
    sign_in(browser, PASSWORD_ONLY)
    enter(browser, new_workspace(browser, two_factors=False))
    first = browser.client.get("/api/tenant")
    later = [browser.client.get("/api/tenant") for _ in range(4)]
    assert first.status_code == 200
    assert {response.status_code for response in later} == {200}
    assert {shape(response) for response in later} == {(5, 2)}
    assert shape(first) == (6, 2)


def test_counts_are_claimed_in_chunks_and_every_call_near_the_limit() -> None:
    counts = BatchedCounts(clock=lambda: 600.0)
    allowed = {"user:a": 100}
    claims = [counts.claim(allowed) for _ in range(12)]
    assert claims[0] == {"user:a": 1}
    assert claims[1:5] == [None, None, None, None]
    assert claims[5] == {"user:a": flush_chunk(100)}
    assert claims[6:10] == [None, None, None, None]
    assert claims[10] == {"user:a": flush_chunk(100)}
    assert claims[11] is None
    counts.learn({"user:a": 49})
    assert counts.claim(allowed) == {"user:a": 2}
    counts.learn({"user:a": 56})
    assert counts.claim(allowed) == {"user:a": 1}


def test_a_new_minute_claims_at_once_and_forgets_the_old_one() -> None:
    now = [600.0]
    counts = BatchedCounts(clock=lambda: now[0])
    assert counts.claim({"user:a": 3000}) == {"user:a": 1}
    assert counts.claim({"user:a": 3000}) is None
    now[0] = 660.0
    assert counts.claim({"user:b": 3000}) == {"user:b": 1}
    assert set(counts.counts) == {"user:b"}
    assert counts.claim({"user:a": 3000}) == {"user:a": 1}
