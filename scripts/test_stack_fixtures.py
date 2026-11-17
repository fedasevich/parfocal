import json
import unittest
from pathlib import Path

try:
    import httpx2  # noqa: F401
except ImportError as missing:
    raise unittest.SkipTest("needs the uv workspace") from missing

from stack_fixtures import MANIFEST, fixtures_dir, missing_locally, small_files


def test_only_the_small_group_goes_into_the_stack_bucket() -> None:
    manifest = {
        "remote": [
            {"file": "a.svs", "groups": ["small"]},
            {"file": "b.xml", "groups": ["small", "camelyon"]},
            {"file": "c.tif", "groups": ["camelyon"]},
        ]
    }
    assert small_files(manifest) == ["a.svs", "b.xml"]


def test_the_real_manifest_holds_the_upload_slide() -> None:
    assert "CMU-1-Small-Region.svs" in small_files(json.loads(MANIFEST.read_text()))


def test_the_fixture_folder_follows_the_typescript_package(tmp_path: Path) -> None:
    assert fixtures_dir({"PARFOCAL_FIXTURES_DIR": str(tmp_path)}) == tmp_path
    assert fixtures_dir({"XDG_CACHE_HOME": str(tmp_path)}) == tmp_path / "parfocal" / "fixtures"


def test_files_not_yet_downloaded_are_named(tmp_path: Path) -> None:
    (tmp_path / "a.svs").write_bytes(b"x")
    assert missing_locally(["a.svs", "b.xml"], tmp_path) == ["b.xml"]
