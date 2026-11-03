import uuid

from parfocal_api.mentions import mentioned_in, token_for


def test_mentions_are_read_from_the_text_once_each_in_order() -> None:
    first, second = uuid.uuid4(), uuid.uuid4()
    text = f"Hi {token_for(first)} and {token_for(second)} and {token_for(first)} @[nobody] @[1234]"
    assert mentioned_in(text) == [first, second]


def test_a_token_in_capitals_names_the_same_person() -> None:
    person = uuid.uuid4()
    assert mentioned_in(token_for(person).upper()) == [person]


def test_plain_at_signs_and_emails_mention_nobody() -> None:
    assert mentioned_in("Only an @name and an email a@b.com and @[not-an-id]") == []
    assert mentioned_in("") == []
