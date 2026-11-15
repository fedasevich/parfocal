import secrets

import pytest
from cryptography.exceptions import InvalidTag
from pydantic import SecretStr

from parfocal_api.auth import SessionCipher, SessionKeyError
from parfocal_api.token_keys import decoded_key, usable_keys


def test_a_key_without_base64_padding_opens_a_session_cipher() -> None:
    unpadded = secrets.token_urlsafe(32)
    assert not unpadded.endswith("=")
    sealed = SessionCipher(unpadded).seal({"user": "u"})
    assert SessionCipher(unpadded).open(sealed) == {"user": "u"}


def test_an_unpadded_key_decodes_to_its_32_bytes() -> None:
    assert len(decoded_key(secrets.token_urlsafe(32))) == 32


def test_a_session_sealed_with_the_previous_key_opens_while_it_is_listed() -> None:
    previous, newer = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    sealed = SessionCipher(previous).seal({"user": "u"})
    overlap = SessionCipher(f"{newer},{previous}")
    assert overlap.open(sealed) == {"user": "u"}
    assert SessionCipher(newer).open(overlap.seal({"user": "v"})) == {"user": "v"}
    with pytest.raises(InvalidTag):
        SessionCipher(newer).open(sealed)


@pytest.mark.parametrize("keys", ["", ",", "change-me", f"{secrets.token_urlsafe(32)},change-me"])
def test_a_session_key_list_with_any_bad_entry_is_refused(keys: str) -> None:
    with pytest.raises(SessionKeyError):
        SessionCipher(keys)


def test_token_keys_are_listed_newest_first_and_any_bad_entry_turns_them_off() -> None:
    newer, previous = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    assert usable_keys(SecretStr(f" {newer} , {previous} ")) == [newer, previous]
    assert usable_keys(SecretStr(newer)) == [newer]
    assert usable_keys(SecretStr(f"{newer},change-me")) is None
    assert usable_keys(SecretStr(",")) is None
    assert usable_keys(None) is None
