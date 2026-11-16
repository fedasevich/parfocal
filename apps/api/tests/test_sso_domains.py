import asyncio
import json
import uuid
from dataclasses import dataclass, field

import httpx2
import pytest
from db_support import APP_URL, with_database
from idp_support import Browser
from test_sso import as_sso_user, make_connection, password_account, session_subject

from parfocal_api.sso_domains import (
    DnsOverHttps,
    DomainProof,
    Lookup,
    issued_proofs,
    prove_sso_domains,
    record_name,
    record_value,
)
from parfocal_common.db import create_engine

TOKEN = "t"

type Answer = tuple[str, ...] | None


@dataclass
class FakeResolver:
    records: dict[str, Answer] = field(default_factory=dict[str, Answer])
    asked: list[str] = field(default_factory=list[str])

    async def txt(self, name: str) -> Answer:
        self.asked.append(name)
        return self.records.get(name, ())


def prove(database: str, resolver: FakeResolver, tenant_id: str) -> tuple[DomainProof, ...]:
    async def go() -> tuple[DomainProof, ...]:
        engine = create_engine(with_database(APP_URL, database))
        try:
            return await prove_sso_domains(engine, resolver, uuid.UUID(tenant_id))
        finally:
            await engine.dispose()

    return asyncio.run(go())


def routes(browser: Browser, domain: str) -> bool:
    started = browser.client.get("/api/auth/sso", params={"domain": domain})
    assert started.status_code == 302
    return not started.headers["location"].startswith("/sign-in?sso=none")


def proof_in(browser: Browser, tenant_id: str, domain: str) -> dict[str, object]:
    stored = browser.sql(
        f"SELECT domain_proofs::text FROM sso_connections WHERE tenant_id = '{tenant_id}'"
    )[0][0]
    return json.loads(str(stored))[domain]


@pytest.mark.db
def test_an_unproven_domain_does_not_route_sso(browser: Browser) -> None:
    _, _, domain = make_connection(browser, proven=False)
    assert not routes(browser, domain)


@pytest.mark.db
def test_an_unproven_domain_links_no_account(browser: Browser) -> None:
    _, organisation, domain = make_connection(browser, proven=False)
    email = f"unproven@{domain}"
    account = password_account(browser, email)
    as_sso_user(browser, organisation, email, [])
    assert browser.login().status_code == 200
    assert session_subject(browser) == browser.idp.subject
    assert session_subject(browser) != account
    assert browser.sql(f"SELECT count(*) FROM users WHERE lower(email) = '{email}'") == [(1,)]


@pytest.mark.db
def test_a_txt_record_proves_the_domain_and_sso_then_routes_and_links(
    browser: Browser, database: str
) -> None:
    tenant_id, organisation, domain = make_connection(browser, proven=False)
    resolver = FakeResolver({record_name(domain): ("other", record_value(TOKEN))})
    [proof] = prove(database, resolver, tenant_id)
    assert (proof.domain, proof.proven, proof.lookup) == (domain, True, Lookup.FOUND)
    assert resolver.asked == [f"_parfocal-sso.{domain}"]
    assert routes(browser, domain)
    email = f"proven@{domain}"
    account = password_account(browser, email)
    as_sso_user(browser, organisation, email, [])
    assert browser.login().status_code == 200
    assert session_subject(browser) == account


@pytest.mark.db
def test_a_failed_lookup_keeps_the_last_proof(browser: Browser, database: str) -> None:
    tenant_id, _, domain = make_connection(browser, proven=False)
    prove(database, FakeResolver({record_name(domain): (record_value(TOKEN),)}), tenant_id)
    proven_at = proof_in(browser, tenant_id, domain)["proven_at"]
    [proof] = prove(database, FakeResolver({record_name(domain): None}), tenant_id)
    assert (proof.proven, proof.lookup) == (True, Lookup.FAILED)
    assert proof_in(browser, tenant_id, domain)["proven_at"] == proven_at
    assert routes(browser, domain)


@pytest.mark.db
def test_a_removed_record_withdraws_the_proof(browser: Browser, database: str) -> None:
    tenant_id, _, domain = make_connection(browser)
    [proof] = prove(database, FakeResolver({record_name(domain): ("unrelated",)}), tenant_id)
    assert (proof.proven, proof.lookup) == (False, Lookup.ABSENT)
    assert proof_in(browser, tenant_id, domain)["token"] == TOKEN
    assert not routes(browser, domain)


def test_running_connect_saml_again_keeps_tokens_and_proofs() -> None:
    kept = {"token": "kept", "proven_at": "2026-11-16T00:00:00+00:00"}
    issued = issued_proofs({"a.example": kept, "gone.example": kept}, ["a.example", "b.example"])
    assert issued["a.example"] == kept
    assert issued["b.example"]["proven_at"] is None
    assert len(str(issued["b.example"]["token"])) >= 32
    assert "gone.example" not in issued


def doh(handler: httpx2.MockTransport) -> DnsOverHttps:
    return DnsOverHttps(httpx2.AsyncClient(transport=handler), "https://doh.invalid/dns-query")


def answering(status_code: int, body: object) -> httpx2.MockTransport:
    def handle(request: httpx2.Request) -> httpx2.Response:
        assert request.url.params["type"] == "TXT"
        assert request.headers["accept"] == "application/dns-json"
        return httpx2.Response(status_code, json=body)

    return httpx2.MockTransport(handle)


def lookup(transport: httpx2.MockTransport) -> tuple[str, ...] | None:
    return asyncio.run(doh(transport).txt("_parfocal-sso.a.example"))


def test_dns_over_https_joins_split_txt_strings() -> None:
    body = {
        "Status": 0,
        "Answer": [
            {"name": "_parfocal-sso.a.example", "type": 16, "data": '"parfocal-sso=ab" "cd"'},
            {"name": "_parfocal-sso.a.example", "type": 5, "data": "alias.example."},
            {"name": "_parfocal-sso.a.example", "type": 16, "data": '"say \\"hi\\""'},
        ],
    }
    assert lookup(answering(200, body)) == ("parfocal-sso=abcd", 'say "hi"')


def test_dns_over_https_reads_a_missing_name_as_no_records() -> None:
    assert lookup(answering(200, {"Status": 3})) == ()
    assert lookup(answering(200, {"Status": 0})) == ()


def test_dns_over_https_reports_every_failure_as_unknown() -> None:
    assert lookup(answering(200, {"Status": 2})) is None
    assert lookup(answering(503, {})) is None
    assert lookup(answering(200, ["not", "an", "object"])) is None

    def unreachable(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectTimeout("timed out", request=request)

    assert lookup(httpx2.MockTransport(unreachable)) is None
