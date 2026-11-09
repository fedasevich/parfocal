import pytest
from db_support import ApiAs
from test_study_templates import TEMPLATES, audited, team, template
from workspace_support import owner

pytestmark = pytest.mark.db

OFFERS = "/api/template-offers"


def test_a_researcher_offers_a_layout_and_the_admin_is_notified(api: ApiAs, database: str) -> None:
    people = team(database)
    offered = api(people["researcher"]).post(OFFERS, json=template("Lab layout"))
    assert offered.status_code == 201, offered.text
    body = offered.json()
    assert (body["name"], body["status"], body["template_id"]) == ("Lab layout", "pending", None)
    assert body["offered_by_user_id"] == str(people["researcher"].user_id)

    notified = owner(
        database,
        "SELECT user_id::text, target_type, payload->>'name' FROM notifications "
        "WHERE kind = 'template-offered'",
    )
    assert notified == [(str(people["admin"].user_id), "template-offer", "Lab layout")]
    assert [row[0] for row in audited(database, body["id"])] == ["template-offer.offered"]

    listed = api(people["admin"]).get(OFFERS)
    assert [offer["id"] for offer in listed.json()] == [body["id"]]
    assert listed.json()[0]["blocks"] == offered.json()["blocks"]


def test_only_admin_rights_read_and_decide_offers(api: ApiAs, database: str) -> None:
    people = team(database)
    offer = api(people["researcher"]).post(OFFERS, json=template("Lab layout")).json()
    assert api(people["researcher"]).get(OFFERS).status_code == 403
    assert api(people["researcher"]).post(f"{OFFERS}/{offer['id']}/acceptance").status_code == 403
    assert api(people["reviewer"]).post(OFFERS, json=template()).status_code == 403
    assert api(people["researcher"]).post(f"{OFFERS}/{offer['id']}/decline").status_code == 403


def test_accepting_an_offer_adds_the_template_to_the_library(api: ApiAs, database: str) -> None:
    people = team(database)
    offer = api(people["researcher"]).post(OFFERS, json=template("Lab layout")).json()
    accepted = api(people["admin"]).post(f"{OFFERS}/{offer['id']}/acceptance")
    assert accepted.status_code == 200, accepted.text
    assert (accepted.json()["name"], accepted.json()["version"]) == ("Lab layout", 1)
    names = [item["name"] for item in api(people["researcher"]).get(TEMPLATES).json()]
    assert "Lab layout" in names
    assert api(people["admin"]).get(OFFERS).json() == []
    again = api(people["admin"]).post(f"{OFFERS}/{offer['id']}/acceptance")
    assert (again.status_code, again.json()["code"]) == (409, "template-offer-decided")
    assert [row[0] for row in audited(database, offer["id"])] == [
        "template-offer.offered",
        "template-offer.accepted",
    ]


def test_declining_an_offer_leaves_the_library_alone(api: ApiAs, database: str) -> None:
    people = team(database)
    before = len(api(people["admin"]).get(TEMPLATES).json())
    offer = api(people["researcher"]).post(OFFERS, json=template("Lab layout")).json()
    assert api(people["admin"]).post(f"{OFFERS}/{offer['id']}/decline").status_code == 204
    assert api(people["admin"]).get(OFFERS).json() == []
    assert len(api(people["admin"]).get(TEMPLATES).json()) == before
    missing = api(people["admin"]).post(f"{OFFERS}/{offer['id']}/decline")
    assert missing.status_code == 409
