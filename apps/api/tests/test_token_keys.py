import secrets

from parfocal_api.auth import SessionCipher
from parfocal_api.token_keys import decoded_key


def test_a_key_without_base64_padding_opens_a_session_cipher() -> None:
    unpadded = secrets.token_urlsafe(32)
    assert not unpadded.endswith("=")
    sealed = SessionCipher(unpadded).seal({"user": "u"})
    assert SessionCipher(unpadded).open(sealed) == {"user": "u"}


def test_an_unpadded_key_decodes_to_its_32_bytes() -> None:
    assert len(decoded_key(secrets.token_urlsafe(32))) == 32
