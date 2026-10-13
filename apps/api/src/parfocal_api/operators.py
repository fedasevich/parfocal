import argparse
import asyncio

from sqlalchemy import delete, insert, select

from parfocal_api.settings import ApiSettings
from parfocal_api.tables import platform_operators
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.settings import load_settings


async def run(database_url: str, action: str, subject: str | None) -> list[str]:
    engine = create_engine(database_url)
    try:
        async with scoped_transaction(engine, DatabaseScope(auth=True)) as connection:
            if action == "add" and subject:
                await connection.execute(insert(platform_operators).values(subject=subject))
            if action == "remove" and subject:
                await connection.execute(
                    delete(platform_operators).where(platform_operators.c.subject == subject)
                )
            rows = await connection.execute(
                select(platform_operators.c.subject).order_by(platform_operators.c.subject)
            )
            return [str(row.subject) for row in rows]
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Manage Parfocal platform operators")
    parser.add_argument("action", choices=["add", "remove", "list"])
    parser.add_argument("subject", nargs="?", help="Zitadel user id of the operator")
    arguments = parser.parse_args(argv)
    if arguments.action != "list" and not arguments.subject:
        parser.error("add and remove need the operator's Zitadel user id")
    settings = load_settings(ApiSettings)
    subjects = asyncio.run(run(str(settings.database_url), arguments.action, arguments.subject))
    for subject in subjects:
        print(subject)


if __name__ == "__main__":
    main()
