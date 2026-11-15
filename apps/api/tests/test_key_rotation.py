import asyncio
import time
from collections.abc import Iterator

import pytest
from cryptography.exceptions import InvalidTag
from db_support import APP_URL, OWNER_URL, migrated_database, query, with_database
from test_identifiers import JANA, PETR, admit, make_tenant, master_key, read
from test_startup import REQUIRED

from parfocal_api.auth import SessionCipher
from parfocal_api.key_rotation import (
    KeyringStatus,
    RetireRefusedError,
    check_retire,
    describe,
    main,
    run,
)
from parfocal_common.envelope import MasterKeyring, UnknownMasterKeyError


@pytest.fixture
def drill() -> Iterator[str]:
    with migrated_database() as name:
        yield name


def rotate(database: str, keyring: MasterKeyring, action: str) -> KeyringStatus:
    return asyncio.run(run(with_database(APP_URL, database), keyring, action))


def ciphertexts(database: str) -> list[tuple[object, ...]]:
    return query(
        with_database(OWNER_URL, database),
        "SELECT id, name_ciphertext, mrn_ciphertext FROM patients ORDER BY id",
    )


@pytest.mark.db
def test_the_master_key_rotation_drill_keeps_every_tenant_readable(drill: str) -> None:
    old, new = master_key(), master_key()
    before = MasterKeyring.from_setting(f"m1:{old}")
    during = MasterKeyring.from_setting(f"m2:{new},m1:{old}")
    after = MasterKeyring.from_setting(f"m2:{new}")
    first, second = make_tenant(drill), make_tenant(drill)
    (jana,) = admit(drill, first, JANA, keyring=before)
    (petr,) = admit(drill, second, PETR, keyring=before)
    stored = ciphertexts(drill)

    status = rotate(drill, during, "status")
    assert status.wrapped_by == {"m1": 4}
    with pytest.raises(RetireRefusedError, match="still wrapped by m1"):
        check_retire(status, "m1")

    started = time.perf_counter()
    rotated = rotate(drill, during, "rewrap")
    print(f"rewrapped in {(time.perf_counter() - started) * 1000:.0f} ms")
    assert "m1" not in rotated.wrapped_by
    check_retire(rotated, "m1")
    assert describe(rotated)[:2] == ["current m2", "listed m2, m1"]

    assert read(drill, first, jana, keyring=after) == JANA
    assert read(drill, second, petr, keyring=after) == PETR
    assert ciphertexts(drill) == stored
    with pytest.raises(UnknownMasterKeyError):
        read(drill, first, jana, keyring=before)


@pytest.mark.db
def test_the_rotation_command_refuses_to_retire_then_rewraps(
    drill: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    old, new = master_key(), master_key()
    tenant = make_tenant(drill)
    admit(drill, tenant, JANA, keyring=MasterKeyring.from_setting(f"m1:{old}"))
    for name, value in REQUIRED.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("DATABASE_URL", with_database(APP_URL, drill))
    monkeypatch.setenv("MASTER_KEYS", f"m2:{new},m1:{old}")
    with pytest.raises(SystemExit, match="Keep m1: 2 tenant keys are still wrapped by m1"):
        main(["check-retire", "m1"])
    main(["rewrap"])
    main(["check-retire", "m1"])
    printed = capsys.readouterr().out.splitlines()
    assert printed[-1] == "m1 wraps nothing and can be removed from MASTER_KEYS"
    assert "wrapped by m2: 2" in printed


@pytest.mark.db
def test_dropping_the_old_key_before_the_rewrap_locks_the_tenant_out(database: str) -> None:
    old, new = master_key(), master_key()
    before = MasterKeyring.from_setting(f"m1:{old}")
    tenant = make_tenant(database)
    (jana,) = admit(database, tenant, JANA, keyring=before)
    with pytest.raises(UnknownMasterKeyError):
        read(database, tenant, jana, keyring=MasterKeyring.from_setting(f"m2:{new}"))
    assert read(database, tenant, jana, keyring=before) == JANA


def status(wrapped_by: dict[str, int], listed: tuple[str, ...] = ("m2", "m1")) -> KeyringStatus:
    return KeyringStatus(current=listed[0], listed=listed, wrapped_by=wrapped_by)


def test_retiring_is_refused_for_the_current_key() -> None:
    with pytest.raises(RetireRefusedError, match="current master key"):
        check_retire(status({"m2": 3}), "m2")


def test_retiring_is_refused_for_a_key_not_listed() -> None:
    with pytest.raises(RetireRefusedError, match="not in MASTER_KEYS"):
        check_retire(status({"m2": 3}), "m0")


def test_retiring_is_refused_while_keys_hang_on_an_unlisted_master() -> None:
    with pytest.raises(RetireRefusedError, match="not listed"):
        check_retire(status({"m0": 1, "m2": 3}), "m1")


def test_retiring_a_key_that_wraps_nothing_is_allowed() -> None:
    check_retire(status({"m2": 3}), "m1")


def test_a_new_session_key_cannot_open_sessions_sealed_with_the_old_one() -> None:
    sealed = SessionCipher(master_key()).seal({"refresh_token": "made-up"})
    with pytest.raises(InvalidTag):
        SessionCipher(master_key()).open(sealed)
