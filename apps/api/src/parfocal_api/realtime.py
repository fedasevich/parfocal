import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Annotated, Protocol, cast

import httpx2
from fastapi import Depends, Request
from pydantic import AnyHttpUrl, BaseModel, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from parfocal_api.settings import ApiSettings
from parfocal_api.token_keys import decoded_key, usable_secret

PUBLISH_HEADER = "X-Room-Signature"
MAX_PUBLISH_ROOMS = 100
EVENT_KIND = r"^[a-z][a-z-]*(\.[a-z][a-z-]*)+$"
ID_NAME = r"^[a-z][a-z_]{0,31}$"

logger = logging.getLogger("parfocal.api.realtime")


class RoomEvent(BaseModel):
    kind: Annotated[str, Field(pattern=EVENT_KIND)]
    ids: Annotated[dict[Annotated[str, Field(pattern=ID_NAME)], uuid.UUID], Field(max_length=8)]

    def wire(self) -> dict[str, object]:
        return {"kind": self.kind, "ids": {name: str(value) for name, value in self.ids.items()}}


class Realtime(Protocol):
    async def publish(
        self, tenant_id: uuid.UUID, rooms: Sequence[str], event: RoomEvent
    ) -> None: ...

    async def revoke(
        self, tenant_id: uuid.UUID, user_id: uuid.UUID, project_id: uuid.UUID | None
    ) -> None: ...


def sign_publish(secret: str, stamp: int, body: str) -> str:
    key = decoded_key(secret)
    digest = hmac.new(key, f"publish.{stamp}.{body}".encode(), hashlib.sha256).digest()
    return f"{stamp}.{base64.urlsafe_b64encode(digest).rstrip(b'=').decode()}"


def compact(body: object) -> str:
    return json.dumps(body, separators=(",", ":"), sort_keys=True)


@dataclass
class EdgeRealtime:
    url: str
    secret: str
    http: httpx2.AsyncClient

    async def send(self, action: str, body: object) -> None:
        text = compact(body)
        headers = {
            PUBLISH_HEADER: sign_publish(self.secret, int(time.time()), text),
            "Content-Type": "application/json",
        }
        try:
            response = await self.http.post(
                f"{self.url}/rt-internal/{action}", content=text, headers=headers
            )
            response.raise_for_status()
        except httpx2.HTTPError as error:
            logger.warning("realtime %s failed: %s", action, type(error).__name__)

    async def publish(self, tenant_id: uuid.UUID, rooms: Sequence[str], event: RoomEvent) -> None:
        wire = event.wire()
        for start in range(0, len(rooms), MAX_PUBLISH_ROOMS):
            chunk = list(rooms[start : start + MAX_PUBLISH_ROOMS])
            await self.send("publish", {"tenant": str(tenant_id), "rooms": chunk, "event": wire})

    async def revoke(
        self, tenant_id: uuid.UUID, user_id: uuid.UUID, project_id: uuid.UUID | None
    ) -> None:
        await self.send(
            "revoke",
            {
                "tenant": str(tenant_id),
                "user": str(user_id),
                "project": None if project_id is None else str(project_id),
            },
        )


@dataclass
class RecordedRealtime:
    published: list[tuple[uuid.UUID, list[str], dict[str, object]]] = field(default_factory=list)
    revoked: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID | None]] = field(default_factory=list)

    async def publish(self, tenant_id: uuid.UUID, rooms: Sequence[str], event: RoomEvent) -> None:
        self.published.append((tenant_id, list(rooms), event.wire()))

    async def revoke(
        self, tenant_id: uuid.UUID, user_id: uuid.UUID, project_id: uuid.UUID | None
    ) -> None:
        self.revoked.append((tenant_id, user_id, project_id))


class NoRealtime:
    async def publish(self, tenant_id: uuid.UUID, rooms: Sequence[str], event: RoomEvent) -> None:
        return

    async def revoke(
        self, tenant_id: uuid.UUID, user_id: uuid.UUID, project_id: uuid.UUID | None
    ) -> None:
        return


class RealtimeSettings(BaseSettings):
    model_config = SettingsConfigDict(frozen=True, extra="ignore")

    room_token_key: SecretStr | None = None
    realtime_internal_url: AnyHttpUrl | None = None


def realtime_for(settings: ApiSettings | RealtimeSettings, http: httpx2.AsyncClient) -> Realtime:
    secret = usable_secret(settings.room_token_key)
    if secret is None or settings.realtime_internal_url is None:
        return NoRealtime()
    return EdgeRealtime(str(settings.realtime_internal_url).rstrip("/"), secret, http)


def realtime_of(request: Request) -> Realtime:
    return cast("Realtime", request.app.state.realtime)


RealtimeClient = Annotated[Realtime, Depends(realtime_of)]
