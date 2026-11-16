import argparse
import asyncio
import sys
import uuid

import httpx2
from pydantic import HttpUrl, PostgresDsn, SecretStr

from parfocal_api.tables import Plan, Region, TenantKind
from parfocal_api.tenant_provisioning import TenantRequest, deprovision, provision
from parfocal_api.zitadel_directory import DirectoryError, ZitadelDirectory
from parfocal_common.db import create_engine
from parfocal_common.envelope import MasterKeyring
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import StorageSettings, load_settings


class ProvisioningSettings(StorageSettings):
    database_url: PostgresDsn
    master_keys: SecretStr
    zitadel_issuer: HttpUrl
    zitadel_admin_token: SecretStr


def parser() -> argparse.ArgumentParser:
    commands = argparse.ArgumentParser(description="Provision or deprovision a Parfocal tenant")
    actions = commands.add_subparsers(dest="action", required=True)
    create = actions.add_parser("provision", help="Create a tenant and its Zitadel organisation")
    create.add_argument("--organisation-slug", required=True)
    create.add_argument("--organisation-name", required=True)
    create.add_argument("--slug", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--kind", required=True, choices=[kind.value for kind in TenantKind])
    create.add_argument("--region", default=Region.EU.value, choices=[r.value for r in Region])
    create.add_argument("--plan", default=Plan.PILOT.value, choices=[p.value for p in Plan])
    remove = actions.add_parser("deprovision", help="Suspend a tenant and remove its data")
    remove.add_argument("tenant_id", type=uuid.UUID)
    return commands


async def run(settings: ProvisioningSettings, arguments: argparse.Namespace) -> str:
    engine = create_engine(str(settings.database_url))
    try:
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectStore(settings.storage(), http)
            directory = ZitadelDirectory(
                str(settings.zitadel_issuer), settings.zitadel_admin_token.get_secret_value(), http
            )
            if arguments.action == "provision":
                created = await provision(
                    engine,
                    MasterKeyring.from_setting(settings.master_keys.get_secret_value()),
                    store,
                    directory,
                    TenantRequest(
                        organisation_slug=arguments.organisation_slug,
                        organisation_name=arguments.organisation_name,
                        slug=arguments.slug,
                        name=arguments.name,
                        kind=TenantKind(arguments.kind),
                        region=Region(arguments.region),
                        plan=Plan(arguments.plan),
                    ),
                )
                return str(created.tenant_id)
            removed = await deprovision(engine, store, directory, arguments.tenant_id)
            return (
                f"{removed.tenant_id} objects_removed={removed.objects_removed} "
                f"keys_shredded={removed.keys_shredded} "
                f"idp_organisation_removed={str(removed.idp_organisation_removed).lower()}"
            )
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None, settings: ProvisioningSettings | None = None) -> None:
    arguments = parser().parse_args(argv)
    try:
        print(asyncio.run(run(settings or load_settings(ProvisioningSettings), arguments)))
    except (DirectoryError, LookupError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
