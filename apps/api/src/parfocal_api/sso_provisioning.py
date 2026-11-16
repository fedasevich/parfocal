import base64
import json
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.sso import GROUPS_KEY, domain_of, using_domain
from parfocal_api.sso_domains import DomainProof, issued_proofs, proofs_of
from parfocal_api.tables import Role, sso_connections, tenants
from parfocal_api.tenant_provisioning import idp_organisation_name
from parfocal_api.zitadel_directory import ZitadelDirectory
from parfocal_common.db import DatabaseScope, scoped_transaction

PLATFORM = DatabaseScope(platform=True)
ACTION_NAME = "parfocalSso"
SSO_LOGIN_POLICY = {
    "allowUsernamePassword": False,
    "allowRegister": False,
    "allowExternalIdp": True,
    "passwordlessType": "PASSWORDLESS_TYPE_NOT_ALLOWED",
    "hidePasswordReset": True,
    "passwordCheckLifetime": "864000s",
    "externalLoginCheckLifetime": "43200s",
    "mfaInitSkipLifetime": "2592000s",
    "secondFactorCheckLifetime": "43200s",
    "multiFactorCheckLifetime": "43200s",
}


class DomainTakenError(LookupError):
    def __init__(self, domain: str) -> None:
        super().__init__(f"Another workspace already signs in {domain} through SSO")


class NoIdpOrganisationError(LookupError):
    def __init__(self, name: str) -> None:
        super().__init__(
            f"The Zitadel organisation {name} does not exist. Provision the tenant first"
        )


@dataclass(frozen=True)
class SamlAttributes:
    email: str = "email"
    groups: str = "groups"
    given_name: str = ""
    family_name: str = ""
    subject: str = ""


@dataclass(frozen=True)
class SamlConnectionRequest:
    tenant_id: uuid.UUID
    metadata_xml: str
    email_domains: tuple[str, ...]
    project_organisation_id: str
    project_id: str
    default_role: Role | None = None
    group_roles: dict[str, Role] = field(default_factory=dict[str, Role])
    attributes: SamlAttributes = SamlAttributes()


@dataclass(frozen=True)
class SamlConnection:
    tenant_id: uuid.UUID
    idp_organisation_id: str
    idp_id: str
    proofs: tuple[DomainProof, ...] = ()


def after_login_script(attributes: SamlAttributes) -> str:
    names = json.dumps(
        {
            "email": attributes.email,
            "groups": attributes.groups,
            "given": attributes.given_name,
            "family": attributes.family_name,
        }
    )
    return (
        f"function {ACTION_NAME}(ctx, api) {{\n"
        f"  let names = {names};\n"
        "  let attributes = ctx.v1.providerInfo.attributes || {};\n"
        "  let first = function (name) {\n"
        "    let values = name ? attributes[name] : null;\n"
        "    return values && values.length ? String(values[0]) : '';\n"
        "  };\n"
        "  let email = first(names.email).toLowerCase();\n"
        "  api.setPreferredUsername(email);\n"
        "  api.setEmail(email);\n"
        "  api.setEmailVerified(true);\n"
        "  api.setFirstName(first(names.given) || email.split('@')[0]);\n"
        "  api.setLastName(first(names.family) || '-');\n"
        "  let full = [first(names.given), first(names.family)].join(' ').trim();\n"
        "  api.setDisplayName(full || email);\n"
        f"  api.v1.user.appendMetadata('{GROUPS_KEY}', attributes[names.groups] || []);\n"
        "}\n"
    )


def saml_settings(request: SamlConnectionRequest, name: str) -> dict[str, object]:
    settings: dict[str, object] = {
        "name": name,
        "metadataXml": base64.b64encode(request.metadata_xml.encode()).decode(),
        "binding": "SAML_BINDING_REDIRECT",
        "withSignedRequest": False,
        "nameIdFormat": "SAML_NAME_ID_FORMAT_PERSISTENT",
        "providerOptions": {
            "isLinkingAllowed": False,
            "isCreationAllowed": True,
            "isAutoCreation": True,
            "isAutoUpdate": True,
        },
    }
    if request.attributes.subject:
        settings["transientMappingAttributeName"] = request.attributes.subject
    return settings


async def connect_saml(
    engine: AsyncEngine, directory: ZitadelDirectory, request: SamlConnectionRequest
) -> SamlConnection:
    domains = tuple(sorted({domain_of(domain) for domain in request.email_domains}))
    async with scoped_transaction(engine, PLATFORM) as connection:
        tenant = (
            await connection.execute(
                select(tenants.c.slug, tenants.c.name).where(tenants.c.id == request.tenant_id)
            )
        ).one_or_none()
        if tenant is None:
            raise LookupError(f"No tenant {request.tenant_id}")
        current = (
            await connection.execute(
                select(sso_connections.c.idp_id, sso_connections.c.domain_proofs).where(
                    sso_connections.c.tenant_id == request.tenant_id
                )
            )
        ).one_or_none()
        existing = None if current is None else str(current.idp_id)
        proofs = issued_proofs({} if current is None else current.domain_proofs, domains)
        for domain in domains:
            taken = await connection.scalar(
                select(sso_connections.c.tenant_id).where(
                    using_domain(domain),
                    sso_connections.c.tenant_id != request.tenant_id,
                )
            )
            if taken is not None:
                raise DomainTakenError(domain)
    organisation_name = idp_organisation_name(tenant.slug)
    organisation_id = await directory.find_organisation(organisation_name)
    if organisation_id is None:
        raise NoIdpOrganisationError(organisation_name)
    await directory.keep_user_names_in_organisation(organisation_id)
    await directory.grant_project(
        request.project_organisation_id, request.project_id, organisation_id
    )
    idp_id = await directory.save_saml_idp(
        organisation_id, existing, saml_settings(request, f"{tenant.name} SSO")
    )
    await directory.require_idp_login(organisation_id, idp_id, SSO_LOGIN_POLICY)
    await directory.run_after_external_login(
        organisation_id, ACTION_NAME, after_login_script(request.attributes)
    )
    values = {
        "idp_organisation_id": organisation_id,
        "idp_id": idp_id,
        "email_domains": list(domains),
        "default_role": request.default_role.value if request.default_role else None,
        "group_roles": {group: role.value for group, role in request.group_roles.items()},
        "domain_proofs": proofs,
    }
    async with scoped_transaction(engine, PLATFORM) as connection:
        await connection.execute(
            upsert(sso_connections)
            .values(tenant_id=request.tenant_id, **values)
            .on_conflict_do_update(index_elements=[sso_connections.c.tenant_id], set_=values)
        )
    return SamlConnection(request.tenant_id, organisation_id, idp_id, proofs_of(proofs))
