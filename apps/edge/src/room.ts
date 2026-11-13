import { roomKey, verifyRoomToken } from "#room-token.ts";
import { problem } from "#tiles.ts";

export type Seat = {
  readonly tenant: string;
  readonly room: string;
  readonly user: string;
  readonly project: string | null;
  readonly expires: number;
};

export type RoomEvent = { readonly kind: string; readonly ids: Readonly<Record<string, string>> };

export type RoomEnv = {
  readonly ROOMS: DurableObjectNamespace;
  readonly ROOM_TOKEN_KEY: string;
};

export type Joined = {
  readonly room: string;
  readonly project: string | null;
  readonly expires: number;
};

export const CLOSE_EXPIRED = 4401;
export const CLOSE_REMOVED = 4403;
export const CLOSE_TOO_BIG = 1009;
export const MAX_CLIENT_FRAME = 4096;
export const ROOM_TOKEN_SECONDS = 300;
export const MAX_SOCKETS_PER_PERSON = 8;

const KIND = /^[a-z][a-z-]*(\.[a-z][a-z-]*)+$/;
const ID_NAME = /^[a-z][a-z_]{0,31}$/;
const ID_VALUE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_IDS = 8;
const INDEX_PREFIX = "joined:";
const REVOKED_PREFIX = "revoked:";
const EVERY_PROJECT = "*";
const VIEWING_PREFIX = "viewing:";
const SLIDE_ROOM = "slide:";
const PROJECT_ROOM = "project:";

type Viewing = { readonly slide: string; readonly user: string; readonly kind: string };

export function roomEventOf(value: unknown): RoomEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { kind, ids } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !KIND.test(kind) || typeof ids !== "object" || ids === null) {
    return null;
  }
  const entries = Object.entries(ids);
  const valid =
    entries.length <= MAX_IDS &&
    entries.every(
      ([name, id]) => ID_NAME.test(name) && typeof id === "string" && ID_VALUE.test(id),
    );
  return valid ? { kind, ids: Object.fromEntries(entries) } : null;
}

export const PRESENCE_JOINED = "presence.joined";
export const PRESENCE_LEFT = "presence.left";

function presenceEvent(kind: string, user: string): RoomEvent {
  return { kind, ids: { user } };
}

function frameOf(event: RoomEvent): string {
  return JSON.stringify({ type: "event", kind: event.kind, ids: event.ids });
}

export function roomStub(env: RoomEnv, tenant: string, room: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(`${tenant}/${room}`));
}

export function userTag(user: string): string {
  return `u:${user}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export class Room {
  now: () => number = () => Math.floor(Date.now() / 1000);
  readonly ctx: DurableObjectState;
  readonly env: RoomEnv;

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/connect") {
      return this.connect(request);
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405 });
    }
    const body: unknown = await request.json();
    if (pathname === "/broadcast") {
      const event = roomEventOf(body);
      return event === null
        ? new Response(null, { status: 400 })
        : json({ sent: this.broadcast(event) });
    }
    if (pathname === "/close") {
      const { user, project } = body as { user: string; project: string | null };
      return json({ closed: await this.closeUser(user, project) });
    }
    if (pathname === "/join") {
      const ok = await this.remember(body as Joined);
      return json({ ok }, ok ? 200 : 403);
    }
    if (pathname === "/viewing") {
      await this.viewing(body as Viewing);
      return json({ ok: true });
    }
    if (pathname === "/revoke") {
      return json({ rooms: await this.revoke((body as { project: string | null }).project) });
    }
    return new Response(null, { status: 404 });
  }

  isFull(seat: Seat): boolean {
    return this.ctx.getWebSockets(userTag(seat.user)).length >= MAX_SOCKETS_PER_PERSON;
  }

  private async connect(request: Request): Promise<Response> {
    const seat = JSON.parse(request.headers.get("X-Room-Seat") ?? "null") as Seat;
    if (this.isFull(seat)) {
      return problem(429, "room-full", "This person has too many connections to this room");
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    await this.join(server, seat);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": request.headers.get("X-Room-Protocol") ?? "" },
    });
  }

  async join(server: WebSocket, seat: Seat): Promise<void> {
    const present = this.presentUsers(new Set());
    this.ctx.acceptWebSocket(server, [userTag(seat.user)]);
    server.serializeAttachment(seat);
    for (const user of present) {
      if (user !== seat.user) {
        server.send(frameOf(presenceEvent(PRESENCE_JOINED, user)));
      }
    }
    if (seat.room.startsWith(PROJECT_ROOM)) {
      const viewing = await this.ctx.storage.list<Viewing>({ prefix: VIEWING_PREFIX });
      for (const { slide, user } of viewing.values()) {
        server.send(frameOf({ kind: PRESENCE_JOINED, ids: { slide, user } }));
      }
    }
    if (!present.has(seat.user)) {
      this.broadcast(presenceEvent(PRESENCE_JOINED, seat.user), new Set([server]));
      await this.tellProject(seat, PRESENCE_JOINED);
    }
    await this.scheduleExpiry();
  }

  private async tellProject(seat: Seat, kind: string): Promise<void> {
    if (seat.project === null || !seat.room.startsWith(SLIDE_ROOM)) {
      return;
    }
    const viewing: Viewing = { slide: seat.room.slice(SLIDE_ROOM.length), user: seat.user, kind };
    await roomStub(this.env, seat.tenant, `${PROJECT_ROOM}${seat.project}`).fetch(
      "https://room/viewing",
      { method: "POST", body: JSON.stringify(viewing) },
    );
  }

  async viewing({ slide, user, kind }: Viewing): Promise<void> {
    const key = `${VIEWING_PREFIX}${slide}/${user}`;
    if (kind === PRESENCE_JOINED) {
      await this.ctx.storage.put(key, { slide, user });
    } else {
      await this.ctx.storage.delete([key]);
    }
    this.broadcast({ kind, ids: { slide, user } });
  }

  broadcast(event: RoomEvent, except: ReadonlySet<WebSocket> = new Set()): number {
    const frame = frameOf(event);
    const now = this.now();
    let sent = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (!except.has(socket) && this.seatOf(socket).expires > now) {
        socket.send(frame);
        sent += 1;
      }
    }
    return sent;
  }

  async closeUser(user: string, project: string | null): Promise<number> {
    const closing = this.ctx
      .getWebSockets(userTag(user))
      .filter((socket) => project === null || this.seatOf(socket).project === project);
    await this.leave(closing, CLOSE_REMOVED, "removed");
    return closing.length;
  }

  private presentUsers(except: ReadonlySet<WebSocket>): Set<string> {
    const now = this.now();
    return new Set(
      this.ctx
        .getWebSockets()
        .filter((socket) => !except.has(socket) && this.seatOf(socket).expires > now)
        .map((socket) => this.seatOf(socket).user),
    );
  }

  private async leave(
    closing: readonly WebSocket[],
    code: number | null,
    reason: string,
  ): Promise<void> {
    const gone = new Set(closing);
    const users = new Map(closing.map((socket) => [this.seatOf(socket).user, this.seatOf(socket)]));
    if (code !== null) {
      for (const socket of closing) {
        socket.close(code, reason);
      }
    }
    const remaining = this.presentUsers(gone);
    for (const [user, seat] of users) {
      if (!remaining.has(user)) {
        this.broadcast(presenceEvent(PRESENCE_LEFT, user), gone);
        await this.tellProject(seat, PRESENCE_LEFT);
      }
    }
  }

  async remember(joined: Joined): Promise<boolean> {
    if (await this.revokedSince(joined.expires - ROOM_TOKEN_SECONDS, joined.project)) {
      return false;
    }
    const key = `${INDEX_PREFIX}${joined.project ?? EVERY_PROJECT}/${joined.room}`;
    const stored = await this.ctx.storage.get<Joined>(key);
    const expires = Math.max(joined.expires, stored?.expires ?? 0);
    await this.ctx.storage.put(key, { ...joined, expires });
    return true;
  }

  private async revokedSince(issued: number, project: string | null): Promise<boolean> {
    const revokes = await this.ctx.storage.list<number>({ prefix: REVOKED_PREFIX });
    const covering = new Set([EVERY_PROJECT, project ?? EVERY_PROJECT]);
    return [...revokes].some(
      ([key, at]) => at >= issued && covering.has(key.slice(REVOKED_PREFIX.length)),
    );
  }

  async revoke(project: string | null): Promise<string[]> {
    const now = this.now();
    const revokes = await this.ctx.storage.list<number>({ prefix: REVOKED_PREFIX });
    const spent = [...revokes]
      .filter(([, at]) => at + ROOM_TOKEN_SECONDS <= now)
      .map(([key]) => key);
    if (spent.length > 0) {
      await this.ctx.storage.delete(spent);
    }
    await this.ctx.storage.put(`${REVOKED_PREFIX}${project ?? EVERY_PROJECT}`, now);
    return this.joined(project);
  }

  async joined(project: string | null): Promise<string[]> {
    const now = this.now();
    const entries = await this.ctx.storage.list<Joined>({ prefix: INDEX_PREFIX });
    const stale = [...entries].filter(([, entry]) => entry.expires <= now).map(([key]) => key);
    if (stale.length > 0) {
      await this.ctx.storage.delete(stale);
    }
    const rooms = [...entries.values()]
      .filter((entry) => entry.expires > now && (project === null || entry.project === project))
      .map((entry) => entry.room);
    return [...new Set(rooms)];
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const size = typeof message === "string" ? message.length : message.byteLength;
    if (typeof message !== "string" || size > MAX_CLIENT_FRAME) {
      socket.close(CLOSE_TOO_BIG, "frame-refused");
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(message);
    } catch {
      return;
    }
    const { type, token } = (frame ?? {}) as Record<string, unknown>;
    if (type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    } else if (type === "renew" && typeof token === "string") {
      await this.renew(socket, token);
    }
  }

  private async renew(socket: WebSocket, token: string): Promise<void> {
    const seat = this.seatOf(socket);
    const access = await verifyRoomToken(token, await roomKey(this.env.ROOM_TOKEN_KEY), this.now());
    if (
      !access.ok ||
      access.grant.tenant !== seat.tenant ||
      access.grant.room !== seat.room ||
      access.grant.user !== seat.user
    ) {
      await this.leave([socket], CLOSE_EXPIRED, "token-refused");
      return;
    }
    const renewed: Seat = {
      ...seat,
      project: access.grant.project,
      expires: access.grant.expires,
    };
    const index = await roomStub(this.env, seat.tenant, `user:${seat.user}`).fetch(
      "https://room/join",
      {
        method: "POST",
        body: JSON.stringify({
          room: seat.room,
          project: renewed.project,
          expires: renewed.expires,
        }),
      },
    );
    if (!index.ok) {
      await this.leave([socket], CLOSE_REMOVED, "removed");
      return;
    }
    socket.serializeAttachment(renewed);
    socket.send(JSON.stringify({ type: "renewed", expires: renewed.expires }));
    await this.scheduleExpiry();
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    await this.leave([socket], null, "closed");
    try {
      socket.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      return;
    }
  }

  async alarm(): Promise<void> {
    const now = this.now();
    const expired = this.ctx.getWebSockets().filter((socket) => this.seatOf(socket).expires <= now);
    await this.leave(expired, CLOSE_EXPIRED, "token-expired");
    await this.scheduleExpiry();
  }

  private async scheduleExpiry(): Promise<void> {
    const now = this.now();
    const ends = this.ctx
      .getWebSockets()
      .map((socket) => this.seatOf(socket).expires)
      .filter((expires) => expires > now);
    if (ends.length > 0) {
      await this.ctx.storage.setAlarm(Math.min(...ends) * 1000);
    }
  }

  private seatOf(socket: WebSocket): Seat {
    return socket.deserializeAttachment() as Seat;
  }
}
