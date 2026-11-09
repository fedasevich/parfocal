import json
import os
import random
import sys
import time
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from load.target import TargetRefusedError, target_from_env
from locust import FastHttpUser, between, events, task
from locust.env import Environment
from locust.exception import StopUser
from websockets.sync.client import ClientConnection, connect

ROOM_PROTOCOL = "parfocal-room-v1"
ROOM_TOKEN_VERSION = 1
ROOM_TOKEN_SECONDS = 300
SESSION_COOKIE = "__Host-parfocal_session"
FIRST_BYTES = 16 * 1024
RANGE_BYTES = 64 * 1024
RANGES_PER_VIEW = 8
PINGS_PER_VISIT = 5
SEARCH_TERMS = ("slide", "case", "tumour", "review")


def setting(name: str) -> str | None:
    return os.environ.get(f"PARFOCAL_LOAD_{name}") or None


def listed(name: str) -> list[str]:
    return [item.strip() for item in (setting(name) or "").split(",") if item.strip()]


def bearer() -> dict[str, str]:
    token = setting("TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


@events.init.add_listener
def refuse_unsafe_targets(environment: Environment, **_: Any) -> None:
    try:
        target_from_env("API_URL", environment.host)
        for name in ("TILES_URL", "REALTIME_URL"):
            if setting(name):
                target_from_env(f"PARFOCAL_LOAD_{name}", None)
    except TargetRefusedError as refused:
        sys.stderr.write(f"{refused}\n")
        sys.exit(2)


class ApiUser(FastHttpUser):
    wait_time = between(1, 3)

    def on_start(self) -> None:
        if not setting("TOKEN"):
            raise StopUser

    @task(1)
    def health(self) -> None:
        self.client.get("/api/health", name="/api/health")

    @task(3)
    def projects(self) -> None:
        self.client.get("/api/projects", headers=bearer(), name="/api/projects")

    @task(2)
    def search(self) -> None:
        self.client.get(
            "/api/search",
            params={"q": random.choice(SEARCH_TERMS)},
            headers=bearer(),
            name="/api/search",
        )


class TileUser(FastHttpUser):
    wait_time = between(0.5, 2)

    def on_start(self) -> None:
        self.slides = listed("SLIDES")
        if not self.slides:
            raise StopUser
        self.tiles = target_from_env("PARFOCAL_LOAD_TILES_URL", self.host)
        self.previous: dict[str, str] = {}

    def access(self, slide: str) -> tuple[str, dict[str, str]]:
        if not setting("TOKEN"):
            return f"/tiles/{slide}/slide.tiff", {}
        headers = bearer()
        if slide in self.previous:
            headers["Previous-Tile-Token"] = self.previous[slide]
        with self.client.get(
            f"/api/slides/{slide}/tile-access",
            headers=headers,
            name="/api/slides/[id]/tile-access",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"tile access answered {response.status_code}")
                raise StopUser
            body = response.json()
        self.previous[slide] = body["token"]
        return body["base_path"] + body["original"], {"Authorization": f"Bearer {body['token']}"}

    def read(self, url: str, headers: dict[str, str], start: int, end: int, name: str) -> int:
        with self.client.get(
            url,
            headers={**headers, "Range": f"bytes={start}-{end}"},
            name=name,
            catch_response=True,
        ) as response:
            if response.status_code != 206:
                response.failure(f"range read answered {response.status_code}")
                return 0
            total = (response.headers.get("Content-Range") or "").rpartition("/")[2]
            return int(total) if total.isdigit() else 0

    @task
    def view(self) -> None:
        slide = random.choice(self.slides)
        path, headers = self.access(slide)
        url = f"{self.tiles}{path}"
        if not setting("TOKEN"):
            self.client.get(
                f"{self.tiles}/tiles/{slide}/levels.json", name="/tiles/[id]/levels.json"
            )
        size = self.read(url, headers, 0, FIRST_BYTES - 1, "/tiles/[id] header")
        if size <= RANGE_BYTES:
            return
        for _ in range(RANGES_PER_VIEW):
            start = random.randrange(0, size - RANGE_BYTES)
            self.read(url, headers, start, start + RANGE_BYTES - 1, "/tiles/[id] range")


def socket_origin(url: str) -> str:
    parts = urlsplit(url)
    scheme = {"http": "ws", "https": "wss"}.get(parts.scheme, parts.scheme)
    return urlunsplit((scheme, parts.netloc, "", "", ""))


def signed_room_token(room: str) -> str:
    from parfocal_api.tile_access import sign_capability

    key = os.environ.get("ROOM_TOKEN_KEY", "")
    tenant = setting("TENANT")
    user = setting("USER")
    if not key or not tenant or not user:
        raise StopUser
    claims = {
        "v": ROOM_TOKEN_VERSION,
        "t": tenant,
        "r": room,
        "u": user,
        "p": setting("PROJECT"),
        "e": int(time.time()) + ROOM_TOKEN_SECONDS,
    }
    return sign_capability(key, claims)


class RoomUser(FastHttpUser):
    wait_time = between(1, 3)

    def on_start(self) -> None:
        realtime = setting("REALTIME_URL")
        if not realtime:
            raise StopUser
        self.api = target_from_env("PARFOCAL_LOAD_API_URL", self.host)
        self.realtime = socket_origin(target_from_env("PARFOCAL_LOAD_REALTIME_URL", realtime))
        self.room = setting("ROOM") or f"user:{setting('USER')}"

    def record(self, name: str, started: float, length: int, error: Exception | None) -> None:
        self.environment.events.request.fire(
            request_type="WS",
            name=name,
            response_time=(time.perf_counter() - started) * 1000,
            response_length=length,
            exception=error,
            context={},
        )

    def room_token(self) -> str:
        session = setting("SESSION")
        if not session:
            return signed_room_token(self.room)
        with self.client.get(
            f"{self.api}/api/rooms/{self.room}/access",
            headers={"Cookie": f"{SESSION_COOKIE}={session}"},
            name="/api/rooms/[room]/access",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"room access answered {response.status_code}")
                raise StopUser
            return response.json()["token"]

    def ping(self, socket: ClientConnection) -> None:
        started = time.perf_counter()
        error: Exception | None = None
        socket.send(json.dumps({"type": "ping"}))
        try:
            while True:
                frame = socket.recv(timeout=10)
                if json.loads(frame).get("type") == "pong":
                    break
        except Exception as failed:
            error = failed
        self.record("pong", started, 0, error)

    @task
    def visit(self) -> None:
        token = self.room_token()
        started = time.perf_counter()
        try:
            socket = connect(
                f"{self.realtime}/rt/{self.room}",
                subprotocols=[ROOM_PROTOCOL, token],
                open_timeout=10,
            )
        except Exception as failed:
            self.record("join", started, 0, failed)
            return
        self.record("join", started, 0, None)
        with socket:
            for _ in range(PINGS_PER_VISIT):
                self.ping(socket)
                time.sleep(random.uniform(0.2, 1))
