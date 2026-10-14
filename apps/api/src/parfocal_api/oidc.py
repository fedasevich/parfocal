from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx2
import jwt

SCOPES = "openid profile email offline_access urn:zitadel:iam:user:resourceowner"


class IdentityError(Exception):
    pass


@dataclass(frozen=True)
class Discovery:
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    end_session_endpoint: str
    revocation_endpoint: str


@dataclass(frozen=True)
class TokenSet:
    id_token: str
    refresh_token: str
    expires_in: int


class OidcClient:
    def __init__(
        self,
        issuer: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        http: httpx2.AsyncClient,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.http = http
        self._discovery: Discovery | None = None
        self._keys: jwt.PyJWKSet | None = None

    async def _get_json(self, url: str) -> dict[str, Any]:
        try:
            response = await self.http.get(url)
            response.raise_for_status()
            body: dict[str, Any] = response.json()
        except (httpx2.HTTPError, ValueError) as error:
            raise IdentityError(f"Could not read {url}") from error
        return body

    async def discovery(self) -> Discovery:
        if self._discovery is None:
            document = await self._get_json(f"{self.issuer}/.well-known/openid-configuration")
            try:
                self._discovery = Discovery(
                    authorization_endpoint=document["authorization_endpoint"],
                    token_endpoint=document["token_endpoint"],
                    jwks_uri=document["jwks_uri"],
                    end_session_endpoint=document["end_session_endpoint"],
                    revocation_endpoint=document["revocation_endpoint"],
                )
            except KeyError as error:
                raise IdentityError("The discovery document is incomplete") from error
        return self._discovery

    async def authorization_url(
        self, state: str, nonce: str, code_challenge: str, prompt: str | None = None
    ) -> str:
        parameters = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": SCOPES,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if prompt is not None:
            parameters["prompt"] = prompt
        query = urlencode(parameters)
        return f"{(await self.discovery()).authorization_endpoint}?{query}"

    async def end_session_url(self, id_token_hint: str, post_logout_redirect_uri: str) -> str:
        query = urlencode(
            {
                "id_token_hint": id_token_hint,
                "client_id": self.client_id,
                "post_logout_redirect_uri": post_logout_redirect_uri,
            }
        )
        return f"{(await self.discovery()).end_session_endpoint}?{query}"

    async def _token(self, form: dict[str, str]) -> TokenSet:
        endpoint = (await self.discovery()).token_endpoint
        try:
            response = await self.http.post(
                endpoint, data=form, auth=(self.client_id, self.client_secret)
            )
            response.raise_for_status()
            body: dict[str, Any] = response.json()
            return TokenSet(
                id_token=str(body["id_token"]),
                refresh_token=str(body["refresh_token"]),
                expires_in=int(body["expires_in"]),
            )
        except (httpx2.HTTPError, ValueError, KeyError) as error:
            raise IdentityError(f"The token request ({form['grant_type']}) failed") from error

    async def exchange(self, code: str, code_verifier: str) -> TokenSet:
        return await self._token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.redirect_uri,
                "code_verifier": code_verifier,
            }
        )

    async def refresh(self, refresh_token: str) -> TokenSet:
        return await self._token({"grant_type": "refresh_token", "refresh_token": refresh_token})

    async def revoke(self, refresh_token: str) -> None:
        endpoint = (await self.discovery()).revocation_endpoint
        try:
            response = await self.http.post(
                endpoint,
                data={"token": refresh_token, "token_type_hint": "refresh_token"},
                auth=(self.client_id, self.client_secret),
            )
            response.raise_for_status()
        except httpx2.HTTPError as error:
            raise IdentityError("Revoking the refresh token failed") from error

    async def _signing_key(self, kid: str) -> jwt.PyJWK:
        for refetch in (False, True):
            if self._keys is None or refetch:
                jwks = await self._get_json((await self.discovery()).jwks_uri)
                self._keys = jwt.PyJWKSet.from_dict(jwks)
            for key in self._keys.keys:
                if key.key_id == kid:
                    return key
        raise IdentityError("The ID token is signed with an unknown key")

    async def verify_id_token(self, token: str, nonce: str | None) -> dict[str, Any]:
        try:
            kid = jwt.get_unverified_header(token).get("kid")
            key = await self._signing_key(str(kid))
            claims: dict[str, Any] = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=self.client_id,
                issuer=self.issuer,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except jwt.PyJWTError as error:
            raise IdentityError("The ID token is not valid") from error
        if nonce is not None and claims.get("nonce") != nonce:
            raise IdentityError("The ID token nonce does not match")
        return claims
