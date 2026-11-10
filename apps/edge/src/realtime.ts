import { type RoomEnv, roomEventOf, roomStub, type Seat } from "#room.ts";
import { ROOM_PROTOCOL } from "#room-client.ts";
import { isRoomName, roomKey, verifyPublish, verifyRoomToken } from "#room-token.ts";
import { problem } from "#tiles.ts";

export const PUBLISH_HEADER = "X-Room-Signature";
export const MAX_PUBLISH_ROOMS = 100;

const ROOM_PREFIX = "/rt/";
const INTERNAL_PREFIX = "/rt-internal/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Defer = (work: Promise<unknown>) => void;

export function isRealtimePath(pathname: string): boolean {
  return pathname.startsWith(ROOM_PREFIX) || pathname.startsWith(INTERNAL_PREFIX);
}

function tokenFromProtocols(header: string | null): string | null {
  const offered = (header ?? "").split(",").map((part) => part.trim());
  if (offered.length !== 2 || offered[0] !== ROOM_PROTOCOL) {
    return null;
  }
  return offered[1] || null;
}

export async function handleRealtime(
  request: Request,
  env: RoomEnv,
  now: () => number,
  defer: Defer,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith(INTERNAL_PREFIX)) {
    return handleInternal(request, env, pathname.slice(INTERNAL_PREFIX.length), now());
  }
  return handleConnect(request, env, roomIn(pathname), now(), defer);
}

function roomIn(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname.slice(ROOM_PREFIX.length));
  } catch {
    return null;
  }
}

async function handleConnect(
  request: Request,
  env: RoomEnv,
  room: string | null,
  now: number,
  defer: Defer,
): Promise<Response> {
  if (request.method !== "GET") {
    return problem(405, "method-not-allowed", "Rooms are joined with GET");
  }
  if (room === null || !isRoomName(room)) {
    return problem(404, "room-not-found", "No such room");
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return problem(426, "websocket-required", "Rooms are joined over a WebSocket");
  }
  const token = tokenFromProtocols(request.headers.get("Sec-WebSocket-Protocol"));
  if (token === null) {
    return problem(401, "room-token-missing", "A room token is required");
  }
  const verdict = await verifyRoomToken(token, await roomKey(env.ROOM_TOKEN_KEY), now);
  if (!verdict.ok) {
    return verdict.reason === "expired"
      ? problem(401, "room-token-expired", "The room token has expired")
      : problem(401, "room-token-invalid", "The room token is not valid");
  }
  const { grant } = verdict;
  if (grant.room !== room) {
    return problem(403, "room-token-other-room", "The room token is for another room");
  }
  const seat: Seat = grant;
  const headers = new Headers(request.headers);
  headers.set("X-Room-Seat", JSON.stringify(seat));
  headers.set("X-Room-Protocol", ROOM_PROTOCOL);
  defer(
    roomStub(env, grant.tenant, `user:${grant.user}`).fetch("https://room/join", {
      method: "POST",
      body: JSON.stringify({ room: grant.room, project: grant.project, expires: grant.expires }),
    }),
  );
  return roomStub(env, grant.tenant, grant.room).fetch(
    new Request("https://room/connect", { method: "GET", headers }),
  );
}

type Publish = { tenant: string; rooms: string[]; event: unknown };
type Revoke = { tenant: string; user: string; project: string | null };

function publishOf(body: unknown): Publish | null {
  const { tenant, rooms, event } = (body ?? {}) as Record<string, unknown>;
  const valid =
    typeof tenant === "string" &&
    UUID.test(tenant) &&
    Array.isArray(rooms) &&
    rooms.length <= MAX_PUBLISH_ROOMS &&
    rooms.every((room) => typeof room === "string" && isRoomName(room));
  return valid ? { tenant, rooms: rooms as string[], event } : null;
}

function revokeOf(body: unknown): Revoke | null {
  const { tenant, user, project } = (body ?? {}) as Record<string, unknown>;
  const valid =
    typeof tenant === "string" &&
    UUID.test(tenant) &&
    typeof user === "string" &&
    UUID.test(user) &&
    (project === null || (typeof project === "string" && UUID.test(project)));
  return valid ? { tenant, user, project } : null;
}

async function handleInternal(
  request: Request,
  env: RoomEnv,
  action: string,
  now: number,
): Promise<Response> {
  if (request.method !== "POST") {
    return problem(405, "method-not-allowed", "Internal room calls use POST");
  }
  const text = await request.text();
  const key = await roomKey(env.ROOM_TOKEN_KEY);
  if (!(await verifyPublish(key, request.headers.get(PUBLISH_HEADER), text, now))) {
    return problem(401, "publish-signature-invalid", "The publish signature is not valid");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return problem(400, "publish-malformed", "The body is not JSON");
  }
  if (action === "publish") {
    return publish(env, publishOf(body));
  }
  if (action === "revoke") {
    return revoke(env, revokeOf(body));
  }
  return problem(404, "not-found", "No such internal call");
}

async function publish(env: RoomEnv, call: Publish | null): Promise<Response> {
  const event = call === null ? null : roomEventOf(call.event);
  if (call === null || event === null) {
    return problem(400, "publish-malformed", "The event is not valid");
  }
  const body = JSON.stringify(event);
  await Promise.all(
    call.rooms.map((room) =>
      roomStub(env, call.tenant, room).fetch("https://room/broadcast", { method: "POST", body }),
    ),
  );
  return Response.json({ rooms: call.rooms.length });
}

async function revoke(env: RoomEnv, call: Revoke | null): Promise<Response> {
  if (call === null) {
    return problem(400, "revoke-malformed", "The revoke is not valid");
  }
  const index = await roomStub(env, call.tenant, `user:${call.user}`).fetch("https://room/joined", {
    method: "POST",
    body: JSON.stringify({ project: call.project }),
  });
  const { rooms } = (await index.json()) as { rooms: string[] };
  const body = JSON.stringify({ user: call.user, project: call.project });
  await Promise.all(
    rooms.map((room) =>
      roomStub(env, call.tenant, room).fetch("https://room/close", { method: "POST", body }),
    ),
  );
  return Response.json({ rooms: rooms.length });
}
