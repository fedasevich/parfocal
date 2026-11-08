import base64
import json
import logging
from uuid import UUID

import pytest
from db_support import ApiAs
from storage_support import ensure_bucket, read_object, stored_keys
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.feedback import PNG_SIGNATURE, feedback_key
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

SCREENSHOT = PNG_SIGNATURE + b"blurred pixels"
SECRET_TEXT = "The overlay hides the tumour margin on case 7"


def team(database: str) -> Workspace:
    return make_workspace(database, {"reader": Role.REVIEWER, "lead": Role.RESEARCHER})


def test_feedback_with_a_screenshot_is_stored_for_the_team_under_its_workspace(
    api: ApiAs, database: str, caplog: pytest.LogCaptureFixture
) -> None:
    ensure_bucket()
    w = team(database)
    caplog.set_level(logging.DEBUG)
    response = api(w.people["reader"]).post(
        "/api/feedback",
        json={
            "text": f"  {SECRET_TEXT}  ",
            "path": "/projects/7c1d/slides/9a2b",
            "app_version": "0.42.0",
            "viewport": [1440, 900],
            "screenshot_png": base64.b64encode(SCREENSHOT).decode(),
        },
    )
    assert response.status_code == 200, response.text
    sent = response.json()
    assert sent["screenshot"] is True
    tenant = w.people["reader"].tenant_id
    feedback_id = UUID(sent["id"])
    assert read_object(feedback_key(tenant, feedback_id, "screenshot.png")) == SCREENSHOT
    note = json.loads(read_object(feedback_key(tenant, feedback_id, "feedback.json")))
    assert note["text"] == SECRET_TEXT
    assert note["path"] == "/projects/7c1d/slides/9a2b"
    assert note["user_id"] == str(w.people["reader"].user_id)
    assert sorted(stored_keys(f"feedback/{tenant}/{feedback_id}/")) == [
        feedback_key(tenant, feedback_id, "feedback.json"),
        feedback_key(tenant, feedback_id, "screenshot.png"),
    ]
    assert owner(
        database,
        f"SELECT action, details FROM audit_events WHERE target_id = '{feedback_id}'",
    ) == [("feedback.sent", '{"screenshot":true}')]
    assert SECRET_TEXT not in caplog.text


def test_feedback_without_a_screenshot_stores_only_the_note(api: ApiAs, database: str) -> None:
    ensure_bucket()
    w = team(database)
    response = api(w.people["lead"]).post(
        "/api/feedback", json={"text": "Export is slow", "path": "/my-work"}
    )
    assert response.status_code == 200, response.text
    tenant = w.people["lead"].tenant_id
    assert stored_keys(f"feedback/{tenant}/{response.json()['id']}/") == [
        f"feedback/{tenant}/{response.json()['id']}/feedback.json"
    ]


@pytest.mark.parametrize(
    "body",
    [
        {"text": "", "path": "/my-work"},
        {"text": "Hi", "path": "/search?q=Smith"},
        {"text": "Hi", "path": "https://elsewhere.example/x"},
        {"text": "Hi", "path": "/my-work", "screenshot_png": base64.b64encode(b"GIF89a").decode()},
        {"text": "Hi", "path": "/my-work", "screenshot_png": "not base64!"},
    ],
)
def test_feedback_refuses_empty_text_query_strings_and_images_that_are_not_png(
    api: ApiAs, database: str, body: dict[str, str]
) -> None:
    w = team(database)
    response = api(w.people["lead"]).post("/api/feedback", json=body)
    assert response.status_code in {400, 422}, response.text
