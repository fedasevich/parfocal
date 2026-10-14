import base64
import os

import pytest

from parfocal_common.envelope import (
    DataKeyUnavailableError,
    InvalidCiphertextError,
    InvalidMasterKeysError,
    MasterKeyring,
    UnknownMasterKeyError,
    decrypt,
    encrypt,
    new_data_key,
    version_of,
)

TENANT = "7b0a8f3e-0000-4000-8000-000000000001"
OTHER_TENANT = "7b0a8f3e-0000-4000-8000-000000000002"
NAME = b"patients.name:7b0a8f3e"


def encoded() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")


def test_a_field_round_trips_and_the_ciphertext_hides_it() -> None:
    key = new_data_key(1)
    ciphertext = encrypt(key, "Jana Nováková", NAME)
    assert b"Nov" not in ciphertext
    assert decrypt({1: key.key}, ciphertext, NAME) == "Jana Nováková"
    assert encrypt(key, "Jana Nováková", NAME) != ciphertext


def test_a_ciphertext_only_opens_in_its_own_context() -> None:
    key = new_data_key(1)
    ciphertext = encrypt(key, "S26-0001", NAME)
    with pytest.raises(InvalidCiphertextError):
        decrypt({1: key.key}, ciphertext, b"patients.mrn:7b0a8f3e")
    damaged = bytearray(ciphertext)
    damaged[-1] ^= 1
    with pytest.raises(InvalidCiphertextError):
        decrypt({1: key.key}, bytes(damaged), NAME)
    relabelled = bytearray(ciphertext)
    relabelled[2] = 2
    with pytest.raises(DataKeyUnavailableError):
        decrypt({1: key.key}, bytes(relabelled), NAME)
    with pytest.raises(InvalidCiphertextError):
        decrypt({1: key.key, 2: key.key}, bytes(relabelled), NAME)


def test_a_wrapped_data_key_belongs_to_one_tenant_and_version() -> None:
    keyring = MasterKeyring.from_setting(f"m1:{encoded()}")
    key = new_data_key(3)
    wrapped = keyring.wrap(TENANT, key)
    assert keyring.unwrap(TENANT, 3, wrapped) == key
    with pytest.raises(InvalidCiphertextError):
        keyring.unwrap(OTHER_TENANT, 3, wrapped)
    with pytest.raises(InvalidCiphertextError):
        keyring.unwrap(TENANT, 4, wrapped)


def test_rotating_the_master_key_keeps_data_readable() -> None:
    old, new = encoded(), encoded()
    before = MasterKeyring.from_setting(f"m1:{old}")
    key = new_data_key(1)
    wrapped = before.wrap(TENANT, key)
    ciphertext = encrypt(key, "Jana Nováková", NAME)

    during = MasterKeyring.from_setting(f"m2:{new},m1:{old}")
    assert during.current == "m2"
    rewrapped = during.rewrap(TENANT, 1, wrapped)
    assert rewrapped.master_id == "m2"
    assert during.rewrap(TENANT, 1, rewrapped) is rewrapped

    after = MasterKeyring.from_setting(f"m2:{new}")
    unwrapped = after.unwrap(TENANT, 1, rewrapped)
    assert decrypt({1: unwrapped.key}, ciphertext, NAME) == "Jana Nováková"
    with pytest.raises(UnknownMasterKeyError):
        after.unwrap(TENANT, 1, wrapped)


def test_rotating_the_data_key_reads_old_and_writes_new() -> None:
    first, second = new_data_key(1), new_data_key(2)
    old = encrypt(first, "Jana Nováková", NAME)
    new = encrypt(second, "Jana Nováková", NAME)
    keys = {1: first.key, 2: second.key}
    assert (version_of(old), version_of(new)) == (1, 2)
    assert decrypt(keys, old, NAME) == decrypt(keys, new, NAME) == "Jana Nováková"
    rewritten = encrypt(second, decrypt(keys, old, NAME), NAME)
    assert decrypt({2: second.key}, rewritten, NAME) == "Jana Nováková"


def test_destroying_a_tenants_keys_makes_its_data_unreadable() -> None:
    keyring = MasterKeyring.from_setting(f"m1:{encoded()}")
    key = new_data_key(1)
    ciphertext = encrypt(key, "Jana Nováková", NAME)
    keyring.wrap(TENANT, key)
    with pytest.raises(DataKeyUnavailableError):
        decrypt({}, ciphertext, NAME)
    with pytest.raises(InvalidCiphertextError):
        decrypt({1: new_data_key(1).key}, ciphertext, NAME)


@pytest.mark.parametrize(
    "setting",
    ["", "m1", "m1:", f":{encoded()}", "m1:c2hvcnQ", f"m1:{encoded()},m1:{encoded()}", "m1:%%%"],
)
def test_malformed_master_keys_are_refused(setting: str) -> None:
    with pytest.raises(InvalidMasterKeysError):
        MasterKeyring.from_setting(setting)
