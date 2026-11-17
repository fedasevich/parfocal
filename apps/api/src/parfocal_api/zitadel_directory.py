from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx2

ACTIVE = "ORGANIZATION_STATE_ACTIVE"
EXTERNAL_AUTHENTICATION_FLOW = 1
POST_AUTHENTICATION = 1


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

    async def org_call(
        self, method: str, path: str, organisation_id: str, body: dict[str, Any] | None
    ) -> httpx2.Response:
        try:
            return await self.http.request(
                method,
                f"{self.base_url.rstrip('/')}{path}",
                json=body,
                headers={
                    "authorization": f"Bearer {self.token}",
                    "accept": "application/json",
                    "x-zitadel-orgid": organisation_id,
                },
            )
        except httpx2.HTTPError as error:
            raise DirectoryError(f"Zitadel did not answer {method} {path}") from error

    async def grant_project(
        self, project_organisation_id: str, project_id: str, organisation_id: str
    ) -> None:
        response = await self.org_call(
            "POST",
            f"/management/v1/projects/{project_id}/grants",
            project_organisation_id,
            {"grantedOrgId": organisation_id},
        )
        if response.status_code not in {200, 409}:
            raise self.refuse(response, "grant the project")

    async def keep_user_names_in_organisation(self, organisation_id: str) -> None:
        policy = {
            "userLoginMustBeDomain": True,
            "validateOrgDomains": False,
            "smtpSenderAddressMatchesInstanceDomain": False,
        }
        path = f"/admin/v1/orgs/{organisation_id}/policies/domain"
        created = await self.call("POST", path, policy)
        if created.status_code == 200:
            return
        changed = await self.call("PUT", path, policy)
        if changed.status_code not in {200, 400}:
            raise self.refuse(changed, "keep user names inside the organisation")

    async def save_saml_idp(
        self, organisation_id: str, idp_id: str | None, settings: dict[str, Any]
    ) -> str:
        if idp_id is None:
            response = await self.org_call(
                "POST", "/management/v1/idps/saml", organisation_id, settings
            )
            if response.status_code != 200:
                raise self.refuse(response, "add the SAML identity provider")
            return str(response.json()["id"])
        response = await self.org_call(
            "PUT", f"/management/v1/idps/saml/{idp_id}", organisation_id, settings
        )
        if response.status_code not in {200, 400}:
            raise self.refuse(response, "update the SAML identity provider")
        return idp_id

    async def require_idp_login(
        self, organisation_id: str, idp_id: str, policy: dict[str, Any]
    ) -> None:
        provider = {"idpId": idp_id, "ownerType": "IDP_OWNER_TYPE_ORG"}
        created = await self.org_call(
            "POST", "/management/v1/policies/login", organisation_id, policy | {"idps": [provider]}
        )
        if created.status_code == 200:
            return
        changed = await self.org_call(
            "PUT", "/management/v1/policies/login", organisation_id, policy
        )
        if changed.status_code not in {200, 400}:
            raise self.refuse(changed, "set the login policy")
        added = await self.org_call(
            "POST", "/management/v1/policies/login/idps", organisation_id, provider
        )
        if added.status_code not in {200, 409}:
            raise self.refuse(added, "add the identity provider to the login policy")

    async def ensure_machine_user(self, organisation_id: str, user_name: str, name: str) -> str:
        by_name = {"userNameQuery": {"userName": user_name, "method": "TEXT_QUERY_METHOD_EQUALS"}}
        found = await self.org_call(
            "POST", "/management/v1/users/_search", organisation_id, {"queries": [by_name]}
        )
        if found.status_code != 200:
            raise self.refuse(found, "search users")
        existing = [str(user["id"]) for user in found.json().get("result", [])]
        if existing:
            return existing[0]
        created = await self.org_call(
            "POST",
            "/management/v1/users/machine",
            organisation_id,
            {"userName": user_name, "name": name, "accessTokenType": "ACCESS_TOKEN_TYPE_BEARER"},
        )
        if created.status_code != 200:
            raise self.refuse(created, "add the machine user")
        return str(created.json()["userId"])

    async def grant_organisation_roles(
        self, organisation_id: str, user_id: str, roles: list[str]
    ) -> None:
        added = await self.org_call(
            "POST",
            "/management/v1/orgs/me/members",
            organisation_id,
            {"userId": user_id, "roles": roles},
        )
        if added.status_code == 200:
            return
        changed = await self.org_call(
            "PUT", f"/management/v1/orgs/me/members/{user_id}", organisation_id, {"roles": roles}
        )
        if changed.status_code not in {200, 400}:
            raise self.refuse(changed, "make the user an organisation manager")

    async def issue_personal_token(
        self, organisation_id: str, user_id: str, expires_at: datetime
    ) -> str:
        response = await self.org_call(
            "POST",
            f"/management/v1/users/{user_id}/pats",
            organisation_id,
            {"expirationDate": expires_at.isoformat().replace("+00:00", "Z")},
        )
        if response.status_code != 200:
            raise self.refuse(response, "issue a personal access token")
        return str(response.json()["token"])

    async def run_after_external_login(self, organisation_id: str, name: str, script: str) -> None:
        action = {"name": name, "script": script, "timeout": "10s", "allowedToFail": False}
        by_name = {"actionNameQuery": {"name": name, "method": "TEXT_QUERY_METHOD_EQUALS"}}
        found = await self.org_call(
            "POST", "/management/v1/actions/_search", organisation_id, {"queries": [by_name]}
        )
        if found.status_code != 200:
            raise self.refuse(found, "search actions")
        existing = [str(item["id"]) for item in found.json().get("result", [])]
        if existing:
            action_id = existing[0]
            response = await self.org_call(
                "PUT", f"/management/v1/actions/{action_id}", organisation_id, action
            )
            if response.status_code not in {200, 400}:
                raise self.refuse(response, "update the action")
        else:
            response = await self.org_call(
                "POST", "/management/v1/actions", organisation_id, action
            )
            if response.status_code != 200:
                raise self.refuse(response, "add the action")
            action_id = str(response.json()["id"])
        trigger = await self.org_call(
            "POST",
            f"/management/v1/flows/{EXTERNAL_AUTHENTICATION_FLOW}/trigger/{POST_AUTHENTICATION}",
            organisation_id,
            {"actionIds": [action_id]},
        )
        if trigger.status_code not in {200, 400}:
            raise self.refuse(trigger, "run the action after external sign-in")
