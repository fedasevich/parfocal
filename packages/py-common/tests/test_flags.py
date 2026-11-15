import json
from pathlib import Path
from typing import Any

import httpx2
import pytest

from parfocal_common.flags import (
    FlagContext,
    FlagEvaluation,
    PostHogRemoteArms,
    RuleFlagClient,
    assign_arm,
    evaluate_flag,
    parse_definitions,
    posthog_flag_request,
    remote_arms_from,
)

FIXTURES = Path(__file__).parent / "fixtures"
WEB_FLAGS = Path(__file__).parents[3] / "apps" / "web" / "src" / "flags" / "flag-defaults.json"
VECTORS: dict[str, Any] = json.loads((FIXTURES / "flag-targeting-vectors.json").read_text())
DEFINITIONS = parse_definitions(VECTORS["definitions"])
BUNDLED = parse_definitions(json.loads(WEB_FLAGS.read_text()))


def context_of(raw: dict[str, Any]) -> FlagContext:
    return FlagContext(
        user_id=raw["userId"], workspace_id=raw.get("workspaceId"), roles=raw.get("roles", ())
    )


@pytest.mark.parametrize("case", VECTORS["cases"])
def test_the_server_matches_the_browser_on_every_vector(case: dict[str, Any]) -> None:
    result = evaluate_flag(DEFINITIONS, case["flag"], context_of(case["context"]), case["remote"])
    assert result == FlagEvaluation(case["expected"]["arm"], case["expected"]["reason"])


def test_the_hash_split_is_balanced() -> None:
    counts = {"control": 0, "status_board": 0}
    for index in range(4000):
        counts[assign_arm("home", f"usr_{index:08d}x", ("control", "status_board"))] += 1
    assert abs(counts["control"] / 4000 - 0.5) < 0.03


def test_the_kill_switch_beats_rules_and_remote_arms() -> None:
    result = evaluate_flag(
        DEFINITIONS,
        "killed_layout",
        FlagContext(user_id="usr_pilot0001"),
        {"killed_layout": "status_board"},
    )
    assert result == FlagEvaluation("control", "killed")


def test_non_pseudonymous_ids_and_unknown_flags_are_refused() -> None:
    with pytest.raises(ValueError, match="user id"):
        evaluate_flag(DEFINITIONS, "home_layout", FlagContext(user_id="jane.doe@example.org"))
    with pytest.raises(ValueError, match="workspace id"):
        evaluate_flag(
            DEFINITIONS,
            "home_layout",
            FlagContext(user_id="usr_00000042x", workspace_id="Holloway Lab"),
        )
    with pytest.raises(KeyError):
        evaluate_flag(DEFINITIONS, "nope", FlagContext(user_id="usr_00000042x"))


def test_the_bundled_web_flag_file_parses_on_the_server() -> None:
    assert set(BUNDLED) == {"lab_lead_default_home"}
    client = RuleFlagClient.from_file(WEB_FLAGS)
    result = client.evaluate("lab_lead_default_home", FlagContext(user_id="usr_00000042x"))
    assert result.reason == "split"


def test_posthog_answers_become_remote_arms() -> None:
    body = {
        "flags": {
            "lab_lead_default_home": {"enabled": True, "variant": "status_board"},
            "not_ours": {"enabled": True, "variant": "x"},
        }
    }
    assert remote_arms_from(body, BUNDLED) == {"lab_lead_default_home": "status_board"}
    off = {"flags": {"lab_lead_default_home": {"enabled": False}}}
    assert remote_arms_from(off, BUNDLED) == {"lab_lead_default_home": False}
    made_up = {"flags": {"lab_lead_default_home": {"enabled": True, "variant": "made_up"}}}
    assert remote_arms_from(made_up, BUNDLED) == {}
    assert remote_arms_from(None, BUNDLED) == {}


def test_the_posthog_request_carries_only_ids_and_role_names() -> None:
    context = FlagContext("usr_00000042x", "wsp_pilotlab1", ("reviewer", "researcher"))
    assert posthog_flag_request("phc_test", context) == {
        "api_key": "phc_test",
        "distinct_id": "usr_00000042x",
        "groups": {"workspace": "wsp_pilotlab1"},
        "person_properties": {"roles": "researcher,reviewer"},
        "group_properties": {},
    }


def test_a_posthog_client_uses_remote_arms_and_falls_back_on_failure() -> None:
    requests: list[httpx2.Request] = []
    status = {"code": 200}

    def handle(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        flags = {"lab_lead_default_home": {"enabled": True, "variant": "status_board"}}
        return httpx2.Response(status["code"], json={"flags": flags})

    with httpx2.Client(transport=httpx2.MockTransport(handle)) as http:
        remote = PostHogRemoteArms(http, "https://posthog.test/", "phc_test", BUNDLED)
        client = RuleFlagClient(BUNDLED, remote)
        context = FlagContext(user_id="usr_00000042x")
        assert client.evaluate("lab_lead_default_home", context) == FlagEvaluation(
            "status_board", "remote"
        )
        assert str(requests[0].url) == "https://posthog.test/flags/?v=2"
        status["code"] = 503
        assert client.evaluate("lab_lead_default_home", context).reason == "split"
