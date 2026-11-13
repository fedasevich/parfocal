from pathlib import Path

from parfocal_common.repository import repository_root


def test_the_root_is_four_folders_above_the_package() -> None:
    assert repository_root("/repo/apps/api/src/parfocal_api/app.py") == Path("/repo")


def test_a_module_copied_to_a_shallow_container_path_gets_the_filesystem_root() -> None:
    assert repository_root("/root/parfocal_api/app.py") == Path("/")


def test_this_checkout_has_its_root_where_the_workspace_file_is() -> None:
    assert (repository_root(__file__, depth=3) / "pyproject.toml").is_file()
