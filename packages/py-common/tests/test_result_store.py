from pathlib import Path

import pytest

from parfocal_common.result_store import LocalResultStore, MissingObjectError


def test_a_local_store_returns_what_was_put(tmp_path: Path) -> None:
    store = LocalResultStore(tmp_path)
    store.put("cells/set/chunk-00000.pfc", b"PFC1")
    assert store.get("cells/set/chunk-00000.pfc") == b"PFC1"


@pytest.mark.parametrize("key", ["cells/set/missing.pfc", "../outside.pfc", "/etc/hosts", "", "."])
def test_missing_and_escaping_keys_are_refused(tmp_path: Path, key: str) -> None:
    store = LocalResultStore(tmp_path / "root")
    (tmp_path / "outside.pfc").write_bytes(b"secret")
    with pytest.raises(MissingObjectError):
        store.get(key)
