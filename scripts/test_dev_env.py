import base64
from pathlib import Path

from dev_env import write_env

EXAMPLE = "\n".join(
    [
        "APP_ENV=dev",
        "SESSION_KEY=",
        "TILE_TOKEN_KEY=",
        "ROOM_TOKEN_KEY=",
        "MASTER_KEYS=",
        "ZITADEL_CLIENT_ID=",
    ]
)


def values(path: Path) -> dict[str, str]:
    pairs = (line.partition("=") for line in path.read_text().splitlines())
    return {name: value for name, _, value in pairs}


def test_a_new_env_gets_every_key_the_api_needs(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text(EXAMPLE)
    added = write_env(tmp_path / ".env.example", tmp_path / ".env")
    env = values(tmp_path / ".env")
    assert sorted(added) == ["MASTER_KEYS", "ROOM_TOKEN_KEY", "SESSION_KEY", "TILE_TOKEN_KEY"]
    assert len(base64.urlsafe_b64decode(env["SESSION_KEY"])) == 32
    assert len(base64.b64decode(env["TILE_TOKEN_KEY"], validate=True)) == 32
    assert env["TILE_TOKEN_KEY"] != env["ROOM_TOKEN_KEY"]
    key_id, _, key = env["MASTER_KEYS"].partition(":")
    assert key_id == "dev"
    assert len(base64.urlsafe_b64decode(key + "=")) == 32
    assert env["ZITADEL_CLIENT_ID"] == ""
    assert (tmp_path / ".env").stat().st_mode & 0o077 == 0


def test_an_existing_env_keeps_its_values(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text(EXAMPLE)
    (tmp_path / ".env").write_text("SESSION_KEY=kept\nTILE_TOKEN_KEY=\nZITADEL_CLIENT_ID=cloud\n")
    added = write_env(tmp_path / ".env.example", tmp_path / ".env")
    env = values(tmp_path / ".env")
    assert added == ["TILE_TOKEN_KEY"]
    assert env["SESSION_KEY"] == "kept"
    assert env["ZITADEL_CLIENT_ID"] == "cloud"
    assert "ROOM_TOKEN_KEY" not in env


def test_a_complete_env_is_not_rewritten(tmp_path: Path) -> None:
    (tmp_path / ".env.example").write_text(EXAMPLE)
    write_env(tmp_path / ".env.example", tmp_path / ".env")
    before = (tmp_path / ".env").read_text()
    assert write_env(tmp_path / ".env.example", tmp_path / ".env") == []
    assert (tmp_path / ".env").read_text() == before
