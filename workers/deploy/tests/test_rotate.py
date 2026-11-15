import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import pytest

from parfocal_api.key_rotation import RetireRefusedError
from parfocal_common.envelope import InvalidMasterKeysError
from parfocal_deploy.bootstrap import new_key
from parfocal_deploy.environments import environment
from parfocal_deploy.rotate import (
    MasterState,
    MissingKeysSecretError,
    RotationRefusedError,
    add_master_key,
    dispatch,
    next_master_id,
    replace_key,
    reset_app_password,
    retire_master_key,
    rewrap,
)
from parfocal_deploy.tools import Tools

TARGET = environment("production")
K1 = new_key()
K2 = new_key()
POOLED = "postgresql://owner@ep-pooler.neon.tech/parfocal?sslmode=require"
DIRECT = "postgresql://owner@ep-direct.neon.tech/parfocal?sslmode=require"


def seeded() -> dict[str, str]:
    return {
        "MASTER_KEYS": f"k1:{K1}",
        "SESSION_KEY": new_key(),
        "TILE_TOKEN_KEY": new_key(),
        "ROOM_TOKEN_KEY": new_key(),
        "DATABASE_URL": "postgresql://parfocal_app@ep-pooler.neon.tech/parfocal",
        "UNRELATED": "kept as it is",
    }


@dataclass
class FakeStore:
    values: dict[str, str] | None = field(default_factory=seeded)
    wrapped_by: dict[str, int] = field(default_factory=lambda: {"k1": 3})
    actions: list[str] = field(default_factory=list)
    merges: list[dict[str, str]] = field(default_factory=list)

    def exists(self) -> bool:
        return self.values is not None

    def keyring(self, action: str) -> MasterState:
        assert self.values is not None
        self.actions.append(action)
        current = self.values["MASTER_KEYS"].split(":", 1)[0]
        if action == "rewrap":
            self.wrapped_by = {current: sum(self.wrapped_by.values())}
        return MasterState(self.values["MASTER_KEYS"], dict(self.wrapped_by))

    def merge(self, values: Mapping[str, str]) -> None:
        assert self.values is not None
        self.merges.append(dict(values))
        self.values |= values


@dataclass
class Recorder:
    argv: list[list[str]] = field(default_factory=list)
    stdin: list[str] = field(default_factory=list)
    statements: list[str] = field(default_factory=list)
    neon_paths: list[str] = field(default_factory=list)

    def run(self, argv: Sequence[str], stdin: str | None, extra: Mapping[str, str] | None) -> None:
        self.argv.append(list(argv))
        if stdin is not None:
            self.stdin.append(stdin)
        assert not extra

    def read(self, argv: Sequence[str]) -> str:
        self.argv.append(list(argv))
        return "[]"

    def sql(self, uri: str, statement: str) -> list[Any]:
        assert uri == DIRECT
        self.statements.append(statement)
        return []

    def neon(self, method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        assert method == "GET"
        self.neon_paths.append(path)
        if path.endswith("/branches"):
            return {"branches": [{"id": "br-main", "name": "main"}]}
        if path.endswith("/databases"):
            return {"databases": [{"name": "parfocal", "owner_name": "owner"}]}
        return {"uri": POOLED if "pooled=true" in path else DIRECT}

    def fetch(self, url: str) -> tuple[int, Mapping[str, str]]:
        raise AssertionError(url)

    def tools(self) -> Tools:
        return Tools(run=self.run, read=self.read, sql=self.sql, neon=self.neon, fetch=self.fetch)


def unchanged_except(before: Mapping[str, str], after: Mapping[str, str], name: str) -> None:
    assert set(after) == set(before)
    assert {key: value for key, value in after.items() if key != name} == {
        key: value for key, value in before.items() if key != name
    }
    assert after[name] != before[name]


def secret_values(*stores: Mapping[str, str]) -> set[str]:
    found: set[str] = set()
    for values in stores:
        for value in values.values():
            found.add(value)
            found.update(part.partition(":")[2] for part in value.split(","))
    return {value for value in found if len(value) >= 8}


def assert_no_secret_in_argv(recorder: Recorder, *stores: Mapping[str, str]) -> None:
    argv = " ".join(" ".join(command) for command in recorder.argv)
    leaked = [value for value in secret_values(*stores) if value in argv]
    assert leaked == []
    assert not any("create" in command and "secret" in command for command in recorder.argv)


def test_adding_a_master_key_puts_it_first_and_keeps_every_other_value() -> None:
    store = FakeStore()
    before = dict(store.values or {})

    key_id = add_master_key(store, make=lambda: K2)

    after = store.values or {}
    assert key_id == "k2"
    assert after["MASTER_KEYS"] == f"k2:{K2},k1:{K1}"
    unchanged_except(before, after, "MASTER_KEYS")
    assert store.merges == [{"MASTER_KEYS": f"k2:{K2},k1:{K1}"}]


def test_the_next_master_id_follows_the_highest_number() -> None:
    assert next_master_id(["k3", "k1", "legacy"]) == "k4"
    assert next_master_id(["legacy"]) == "k1"


def test_a_malformed_new_master_key_is_never_written() -> None:
    store = FakeStore()

    with pytest.raises(InvalidMasterKeysError):
        add_master_key(store, make=lambda: "too-short")

    assert store.merges == []


def test_retiring_keeps_the_current_key_and_every_other_value() -> None:
    store = FakeStore()
    add_master_key(store, make=lambda: K2)
    rewrap(store)
    before = dict(store.values or {})

    retire_master_key(store, "k1")

    after = store.values or {}
    assert after["MASTER_KEYS"] == f"k2:{K2}"
    unchanged_except(before, after, "MASTER_KEYS")
    assert store.actions == ["status", "rewrap", "status"]


@pytest.mark.parametrize(
    ("wrapped_by", "key_id", "reason"),
    [
        ({"k1": 3}, "k1", "3 tenant keys are still wrapped by k1"),
        ({"k2": 3}, "k2", "k2 is the current master key"),
        ({"k2": 3}, "k9", "k9 is not in MASTER_KEYS"),
        ({"k2": 2, "k0": 1}, "k1", "not listed"),
    ],
)
def test_a_master_key_that_may_still_wrap_tenant_keys_is_never_dropped(
    wrapped_by: dict[str, int], key_id: str, reason: str
) -> None:
    store = FakeStore()
    add_master_key(store, make=lambda: K2)
    store.wrapped_by = wrapped_by
    before = dict(store.values or {})
    merges = len(store.merges)

    with pytest.raises(RetireRefusedError, match=reason):
        retire_master_key(store, key_id)

    assert store.values == before
    assert len(store.merges) == merges


def test_the_only_master_key_is_never_dropped() -> None:
    store = FakeStore(wrapped_by={})

    with pytest.raises(RetireRefusedError, match="current"):
        retire_master_key(store, "k1")

    assert store.merges == []


def test_the_session_key_changes_only_in_the_keys_secret() -> None:
    store = FakeStore()
    recorder = Recorder()
    before = dict(store.values or {})

    replace_key(store, recorder.tools(), TARGET, "SESSION_KEY")

    unchanged_except(before, store.values or {}, "SESSION_KEY")
    assert recorder.argv == []
    assert recorder.stdin == []


@pytest.mark.parametrize("name", ["TILE_TOKEN_KEY", "ROOM_TOKEN_KEY"])
def test_a_shared_token_key_changes_in_the_worker_and_the_secret_together(name: str) -> None:
    store = FakeStore()
    recorder = Recorder()
    before = dict(store.values or {})

    replace_key(store, recorder.tools(), TARGET, name)

    after = store.values or {}
    unchanged_except(before, after, name)
    assert recorder.argv == [
        [
            "pnpm",
            "--filter",
            "@parfocal/edge",
            "exec",
            "wrangler",
            "secret",
            "bulk",
            "--env",
            "production",
        ]
    ]
    assert [json.loads(stdin) for stdin in recorder.stdin] == [{name: after[name]}]
    assert_no_secret_in_argv(recorder, before, after)


def test_only_the_known_keys_can_be_replaced() -> None:
    store = FakeStore()

    with pytest.raises(RotationRefusedError, match="DATABASE_URL"):
        replace_key(store, Recorder().tools(), TARGET, "DATABASE_URL")

    assert store.merges == []


def test_the_app_password_changes_in_the_role_and_the_url_together() -> None:
    store = FakeStore()
    recorder = Recorder()
    before = dict(store.values or {})
    password = new_key()

    reset_app_password(
        store,
        recorder.tools(),
        TARGET,
        {"NEON_API_KEY": "neon-api-key-value", "NEON_PROJECT_ID": "project-1"},
        make=lambda: password,
    )

    after = store.values or {}
    unchanged_except(before, after, "DATABASE_URL")
    assert recorder.statements == [f"ALTER ROLE parfocal_app PASSWORD '{password}'"]
    assert after["DATABASE_URL"].startswith(f"postgresql://parfocal_app:{password}@ep-pooler")
    assert recorder.argv == []
    assert all(password not in path for path in recorder.neon_paths)


def test_a_missing_keys_secret_is_never_created_in_part() -> None:
    store = FakeStore(values=None)
    recorder = Recorder()
    local = {"NEON_API_KEY": "neon-api-key-value", "NEON_PROJECT_ID": "project-1"}

    for attempt in (
        lambda: add_master_key(store),
        lambda: rewrap(store),
        lambda: retire_master_key(store, "k1"),
        lambda: replace_key(store, recorder.tools(), TARGET, "TILE_TOKEN_KEY"),
        lambda: reset_app_password(store, recorder.tools(), TARGET, local),
    ):
        with pytest.raises(MissingKeysSecretError):
            attempt()

    assert store.merges == []
    assert recorder.argv == []
    assert recorder.statements == []


def test_the_commands_take_names_and_never_key_material() -> None:
    store = FakeStore()
    recorder = Recorder()
    before = dict(store.values or {})

    messages = [
        dispatch(argparse.Namespace(command=command, **extra), store, recorder.tools(), TARGET)
        for command, extra in (
            ("add-master-key", {}),
            ("rewrap", {}),
            ("retire-master-key", {"key_id": "k1"}),
            ("replace-key", {"name": "ROOM_TOKEN_KEY"}),
        )
    ]

    assert messages[0].startswith("k2 is the current master key")
    assert messages[1] == "tenant keys wrapped by k2: 3"
    assert store.values is not None
    assert store.values["MASTER_KEYS"].startswith("k2:")
    assert store.values["UNRELATED"] == before["UNRELATED"]
    assert_no_secret_in_argv(recorder, before, store.values)
