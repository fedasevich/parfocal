import base64
import secrets
import sys
from collections.abc import Callable
from pathlib import Path

KEY_BYTES = 32


def urlsafe_key() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(KEY_BYTES)).decode()


def standard_key() -> str:
    return base64.b64encode(secrets.token_bytes(KEY_BYTES)).decode()


def master_keys() -> str:
    return "dev:" + urlsafe_key().rstrip("=")


GENERATED: dict[str, Callable[[], str]] = {
    "SESSION_KEY": urlsafe_key,
    "TILE_TOKEN_KEY": standard_key,
    "ROOM_TOKEN_KEY": standard_key,
    "MASTER_KEYS": master_keys,
}


def filled(lines: list[str]) -> tuple[list[str], list[str]]:
    result: list[str] = []
    added: list[str] = []
    for line in lines:
        name, separator, value = line.partition("=")
        if separator and name in GENERATED and not value.strip():
            result.append(f"{name}={GENERATED[name]()}")
            added.append(name)
        else:
            result.append(line)
    return result, added


def write_env(example: Path, target: Path) -> list[str]:
    source = target if target.exists() else example
    lines, added = filled(source.read_text().splitlines())
    if added or not target.exists():
        target.write_text("\n".join(lines) + "\n")
        target.chmod(0o600)
    return added


def main() -> None:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    added = write_env(root / ".env.example", root / ".env")
    if added:
        print(f".env: generated {', '.join(added)}")


if __name__ == "__main__":
    main()
