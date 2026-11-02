import { roomKey, verifyRoomToken } from "#room-token.ts";

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

const KIND = /^[a-z][a-z-]*(\.[a-z][a-z-]*)+$/;
const ID_NAME = /^[a-z][a-z_]{0,31}$/;
const ID_VALUE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_IDS = 8;
const INDEX_PREFIX = "joined:";

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
      return json({ closed: this.closeUser(user, project) });
    }
    if (pathname === "/join") {
      await this.remember(body as Joined);
      return json({ ok: true });
    }
    if (pathname === "/joined") {
      return json({ rooms: await this.joined((body as { project: string | null }).project) });
    }
    return new Response(null, { status: 404 });
  }

  private connect(request: Request): Response {
    const seat = JSON.parse(request.headers.get("X-Room-Seat") ?? "null") as Seat;
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.join(server, seat);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": request.headers.get("X-Room-Protocol") ?? "" },
    });
  }

  join(server: WebSocket, seat: Seat): void {
    this.ctx.acceptWebSocket(server, [userTag(seat.user)]);
    server.serializeAttachment(seat);
    void this.scheduleExpiry();
  }

  broadcast(event: RoomEvent): number {
    const frame = JSON.stringify({ type: "event", kind: event.kind, ids: event.ids });
    const now = this.now();
    let sent = 0;
    for (const socket of this.ctx.getWebSockets()) {
      if (this.seatOf(socket).expires > now) {
        socket.send(frame);
        sent += 1;
      }
    }
    return sent;
  }

  closeUser(user: string, project: string | null): number {
    let closed = 0;
    for (const socket of this.ctx.getWebSockets(userTag(user))) {
      if (project === null || this.seatOf(socket).project === project) {
        socket.close(CLOSE_REMOVED, "removed");
        closed += 1;
      }
    }
    return closed;
  }

  async remember(joined: Joined): Promise<void> {
    await this.ctx.storage.put(`${INDEX_PREFIX}${joined.room}`, joined);
  }

  async joined(project: string | null): Promise<string[]> {
    const now = this.now();
    const entries = await this.ctx.storage.list<Joined>({ prefix: INDEX_PREFIX });
    const stale = [...entries].filter(([, entry]) => entry.expires <= now).map(([key]) => key);
    if (stale.length > 0) {
      await this.ctx.storage.delete(stale);
    }
    return [...entries.values()]
      .filter((entry) => entry.expires > now && (project === null || entry.project === project))
      .map((entry) => entry.room);
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
    const verdict = await verifyRoomToken(
      token,
      await roomKey(this.env.ROOM_TOKEN_KEY),
      this.now(),
    );
    if (
      !verdict.ok ||
      verdict.grant.tenant !== seat.tenant ||
      verdict.grant.room !== seat.room ||
      verdict.grant.user !== seat.user
    ) {
      socket.close(CLOSE_EXPIRED, "token-refused");
      return;
    }
    const renewed: Seat = {
      ...seat,
      project: verdict.grant.project,
      expires: verdict.grant.expires,
    };
    socket.serializeAttachment(renewed);
    socket.send(JSON.stringify({ type: "renewed", expires: renewed.expires }));
    await roomStub(this.env, seat.tenant, `user:${seat.user}`).fetch("https://room/join", {
      method: "POST",
      body: JSON.stringify({ room: seat.room, project: renewed.project, expires: renewed.expires }),
    });
    await this.scheduleExpiry();
  }

  webSocketClose(socket: WebSocket, code: number): void {
    try {
      socket.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      return;
    }
  }

  async alarm(): Promise<void> {
    const now = this.now();
    for (const socket of this.ctx.getWebSockets()) {
      if (this.seatOf(socket).expires <= now) {
        socket.close(CLOSE_EXPIRED, "token-expired");
      }
    }
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
