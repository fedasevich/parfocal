from dataclasses import dataclass
from typing import Any

import httpx2

ACTIVE = "ORGANIZATION_STATE_ACTIVE"


class DirectoryError(Exception):
    pass


class AmbiguousOrganisationError(DirectoryError):
    def __init__(self, name: str, count: int) -> None:
        super().__init__(f"{count} Zitadel organisations are named {name}")


@dataclass(frozen=True)
class ZitadelDirectory:
    base_url: str
    token: str
    http: httpx2.AsyncClient

    async def call(self, method: str, path: str, body: dict[str, Any] | None) -> httpx2.Response:
        try:
            return await self.http.request(
                method,
                f"{self.base_url.rstrip('/')}{path}",
                json=body,
                headers={"authorization": f"Bearer {self.token}", "accept": "application/json"},
            )
        except httpx2.HTTPError as error:
            raise DirectoryError(f"Zitadel did not answer {method} {path}") from error

    @staticmethod
    def refuse(response: httpx2.Response, action: str) -> DirectoryError:
        return DirectoryError(f"Zitadel refused to {action}: {response.status_code}")

    async def find_organisation(self, name: str) -> str | None:
        response = await self.call(
            "POST",
            "/v2/organizations/_search",
            {
                "queries": [
                    {"nameQuery": {"name": name, "method": "TEXT_QUERY_METHOD_EQUALS"}},
                ]
            },
        )
        if response.status_code != 200:
            raise self.refuse(response, "search organisations")
        found: list[dict[str, Any]] = response.json().get("result", [])
        matching = [
            str(organisation["id"])
            for organisation in found
            if organisation.get("name") == name and organisation.get("state") == ACTIVE
        ]
        if len(matching) > 1:
            raise AmbiguousOrganisationError(name, len(matching))
        return matching[0] if matching else None

    async def ensure_organisation(self, name: str) -> str:
        existing = await self.find_organisation(name)
        if existing is not None:
            return existing
        response = await self.call("POST", "/v2/organizations", {"name": name})
        if response.status_code in {200, 201}:
            return str(response.json()["organizationId"])
        if response.status_code == 409:
            raced = await self.find_organisation(name)
            if raced is not None:
                return raced
        raise self.refuse(response, "create an organisation")

    async def remove_organisation(self, organisation_id: str) -> None:
        response = await self.call("DELETE", f"/v2/organizations/{organisation_id}", None)
        if response.status_code not in {200, 404}:
            raise self.refuse(response, "delete an organisation")
