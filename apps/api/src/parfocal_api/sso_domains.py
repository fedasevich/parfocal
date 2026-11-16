import re
import secrets
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Protocol, cast

import httpx2
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.tables import sso_connections
from parfocal_common.db import DatabaseScope, scoped_transaction

PLATFORM = DatabaseScope(platform=True)
RECORD_PREFIX = "_parfocal-sso"
VALUE_PREFIX = "parfocal-sso="
DNS_OVER_HTTPS = "https://cloudflare-dns.com/dns-query"
TXT_TYPE = 16
NOERROR = 0
NXDOMAIN = 3
QUOTED = re.compile(r'"((?:[^"\\]|\\.)*)"')

type Proofs = dict[str, dict[str, str | None]]


class Lookup(StrEnum):
    FOUND = "found"
    ABSENT = "absent"
    FAILED = "lookup failed"


class TxtResolver(Protocol):
    async def txt(self, name: str) -> tuple[str, ...] | None: ...


@dataclass(frozen=True)
class DomainProof:
    domain: str
    record: str
    value: str
    proven: bool
    lookup: Lookup | None = None


def record_name(domain: str) -> str:
    return f"{RECORD_PREFIX}.{domain}"


def record_value(token: str) -> str:
    return f"{VALUE_PREFIX}{token}"


def issued_proofs(existing: dict[str, Any], domains: Iterable[str]) -> Proofs:
    issued: Proofs = {}
    for domain in domains:
        kept: object = existing.get(domain)
        if isinstance(kept, dict) and isinstance(cast("dict[str, object]", kept).get("token"), str):
            issued[domain] = cast("dict[str, str | None]", kept)
        else:
            issued[domain] = {"token": secrets.token_urlsafe(24), "proven_at": None}
    return issued


def proofs_of(proofs: Proofs, lookups: dict[str, Lookup] | None = None) -> tuple[DomainProof, ...]:
    return tuple(
        DomainProof(
            domain=domain,
            record=record_name(domain),
            value=record_value(str(proof["token"])),
            proven=bool(proof.get("proven_at")),
            lookup=(lookups or {}).get(domain),
        )
        for domain, proof in sorted(proofs.items())
    )


def txt_strings(data: str) -> str:
    parts = QUOTED.findall(data)
    joined = "".join(parts) if parts else data
    return re.sub(r"\\(.)", r"\1", joined)


class DnsOverHttps:
    def __init__(self, http: httpx2.AsyncClient, url: str = DNS_OVER_HTTPS) -> None:
        self.http = http
        self.url = url

    async def txt(self, name: str) -> tuple[str, ...] | None:
        try:
            response = await self.http.get(
                self.url,
                params={"name": name, "type": "TXT"},
                headers={"accept": "application/dns-json"},
            )
            if response.status_code != 200:
                return None
            body: object = response.json()
        except httpx2.HTTPError, ValueError:
            return None
        if not isinstance(body, dict):
            return None
        answer = cast("dict[str, Any]", body)
        status: object = answer.get("Status")
        if status == NXDOMAIN:
            return ()
        if status != NOERROR:
            return None
        records: object = answer.get("Answer") or []
        if not isinstance(records, list):
            return None
        found: list[str] = []
        for record in cast("list[object]", records):
            if not isinstance(record, dict):
                continue
            fields = cast("dict[str, object]", record)
            if fields.get("type") == TXT_TYPE and "data" in fields:
                found.append(txt_strings(str(fields["data"])))
        return tuple(found)


def checked(proof: dict[str, str | None], records: tuple[str, ...] | None, now: str) -> Lookup:
    if records is None:
        return Lookup.FAILED
    proof["checked_at"] = now
    if record_value(str(proof["token"])) in {record.strip() for record in records}:
        proof["proven_at"] = proof.get("proven_at") or now
        return Lookup.FOUND
    proof["proven_at"] = None
    return Lookup.ABSENT


async def prove_sso_domains(
    engine: AsyncEngine, resolver: TxtResolver, tenant_id: uuid.UUID
) -> tuple[DomainProof, ...]:
    async with scoped_transaction(engine, PLATFORM) as connection:
        row = (
            await connection.execute(
                select(sso_connections.c.email_domains, sso_connections.c.domain_proofs).where(
                    sso_connections.c.tenant_id == tenant_id
                )
            )
        ).one_or_none()
    if row is None:
        raise LookupError(f"No SSO connection for tenant {tenant_id}. Run connect-saml first")
    proofs = issued_proofs(row.domain_proofs, row.email_domains)
    now = datetime.now(UTC).isoformat()
    lookups = {
        domain: checked(proof, await resolver.txt(record_name(domain)), now)
        for domain, proof in proofs.items()
    }
    async with scoped_transaction(engine, PLATFORM) as connection:
        await connection.execute(
            update(sso_connections)
            .where(sso_connections.c.tenant_id == tenant_id)
            .values(domain_proofs=proofs)
        )
    return proofs_of(proofs, lookups)
