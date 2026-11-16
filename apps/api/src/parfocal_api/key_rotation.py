import argparse
import asyncio
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.identifiers import rewrap_keys
from parfocal_api.settings import ApiSettings
from parfocal_api.tables import tenant_keys
from parfocal_common.db import (
    DatabaseScope,
    create_engine,
    require_row_security,
    scoped_transaction,
)
from parfocal_common.envelope import MasterKeyring
from parfocal_common.settings import load_settings

PLATFORM = DatabaseScope(platform=True)


class RetireRefusedError(Exception):
    pass


@dataclass(frozen=True)
class KeyringStatus:
    current: str
    listed: tuple[str, ...]
    wrapped_by: dict[str, int]


async def wrapped_by(connection: AsyncConnection) -> dict[str, int]:
    rows = await connection.execute(
        select(tenant_keys.c.master_id, func.count())
        .group_by(tenant_keys.c.master_id)
        .order_by(tenant_keys.c.master_id)
    )
    return {str(row[0]): int(row[1]) for row in rows}


def keyring_status(keyring: MasterKeyring, counts: dict[str, int]) -> KeyringStatus:
    return KeyringStatus(keyring.current, tuple(keyring.keys), counts)


def check_retire(status: KeyringStatus, key_id: str) -> None:
    if key_id not in status.listed:
        raise RetireRefusedError(f"{key_id} is not in MASTER_KEYS")
    if key_id == status.current:
        raise RetireRefusedError(f"{key_id} is the current master key")
    unknown = sorted(set(status.wrapped_by) - set(status.listed))
    if unknown:
        raise RetireRefusedError(f"keys are wrapped by master keys not listed: {unknown}")
    remaining = status.wrapped_by.get(key_id, 0)
    if remaining:
        raise RetireRefusedError(f"{remaining} tenant keys are still wrapped by {key_id}")


async def run(database_url: str, keyring: MasterKeyring, action: str) -> KeyringStatus:
    engine = create_engine(database_url)
    try:
        await require_row_security(engine)
        async with scoped_transaction(engine, PLATFORM) as connection:
            if action == "rewrap":
                await rewrap_keys(connection, keyring)
            return keyring_status(keyring, await wrapped_by(connection))
    finally:
        await engine.dispose()


def describe(status: KeyringStatus) -> list[str]:
    lines = [f"current {status.current}", f"listed {', '.join(status.listed)}"]
    lines += [f"wrapped by {key_id}: {count}" for key_id, count in status.wrapped_by.items()]
    return lines


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Rotate the Parfocal master keyring")
    parser.add_argument("action", choices=["status", "rewrap", "check-retire"])
    parser.add_argument("key_id", nargs="?", help="Master key id to retire")
    arguments = parser.parse_args(argv)
    if arguments.action == "check-retire" and not arguments.key_id:
        parser.error("check-retire needs the id of the master key to retire")
    settings = load_settings(ApiSettings)
    keyring = MasterKeyring.from_setting(settings.master_keys.get_secret_value())
    action = "status" if arguments.action == "check-retire" else arguments.action
    status = asyncio.run(run(str(settings.database_url), keyring, action))
    for line in describe(status):
        print(line)
    if arguments.action == "check-retire":
        try:
            check_retire(status, arguments.key_id)
        except RetireRefusedError as error:
            raise SystemExit(f"Keep {arguments.key_id}: {error}") from error
        print(f"{arguments.key_id} wraps nothing and can be removed from MASTER_KEYS")


if __name__ == "__main__":
    main()
