import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { signCapability, signingKey } from "../src/capability.ts";
import { handleRealtime, MAX_INTERNAL_BODY, PUBLISH_HEADER } from "../src/realtime.ts";
import {
  CLOSE_EXPIRED,
  CLOSE_REMOVED,
  CLOSE_TOO_BIG,
  MAX_CURSOR_FRAMES_PER_SECOND,
  MAX_SOCKETS_PER_PERSON,
  MAX_VIEW_FRAMES_PER_SECOND,
  ROOM_TOKEN_SECONDS,
  Room,
  type RoomEnv,
  type Seat,
} from "../src/room.ts";
import { ROOM_PROTOCOL } from "../src/room-client.ts";
import {
  type RoomGrant,
  roomKey,
  signPublish,
  signRoomToken,
  verifyPublish,
  verifyRoomToken,
} from "../src/room-token.ts";

type Vector = {
  secret: string;
  token: string;
  claims: { t: string; r: string; u: string; p: string | null; e: number };
  publish: { stamp: number; body: string; signature: string };
};

const vector = JSON.parse(
  readFileSync(`${import.meta.dirname}/room-token-vector.json`, "utf8"),
) as Vector;
const SECRET = vector.secret;
const NOW = 1_800_000_000;
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const SLIDE = "slide:33333333-3333-4333-8333-333333333333";
const OTHER_SLIDE = "slide:44444444-4444-4444-8444-444444444444";
const PROJECT = "55555555-5555-4555-8555-555555555555";
const ANNA = "66666666-6666-4666-8666-666666666666";
const BEN = "77777777-7777-4777-8777-777777777777";

class FakeSocket {
  readonly sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  tags: string[] = [];
  private attachment: unknown = null;

  send(text: string): void {
    assert.equal(this.closed, null, "sent on a closed socket");
    this.sent.push(text);
  }

  close(code: number, reason: string): void {
    this.closed ??= { code, reason };
  }

  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }

  events(): { kind: string; ids: Record<string, string> }[] {
    return this.sent
      .map(
        (text) => JSON.parse(text) as { type: string; kind: string; ids: Record<string, string> },
      )
      .filter((frame) => frame.type === "event")
      .map(({ kind, ids }) => ({ kind, ids }));
  }
}

class FakeState {
  readonly sockets: FakeSocket[] = [];
  readonly stored = new Map<string, unknown>();
  alarm: number | null = null;

  readonly storage = {
    get: (key: string) => Promise.resolve(this.stored.get(key)),
    put: (key: string, value: unknown) => {
      this.stored.set(key, structuredClone(value));
      return Promise.resolve();
    },
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve(new Map([...this.stored].filter(([key]) => key.startsWith(prefix)))),
    delete: (keys: string[]) => {
      for (const key of keys) {
        this.stored.delete(key);
      }
      return Promise.resolve(keys.length);
    },
    setAlarm: (when: number) => {
      this.alarm = when;
      return Promise.resolve();
    },
  };

  acceptWebSocket(socket: FakeSocket, tags: string[]): void {
    socket.tags = tags;
    this.sockets.push(socket);
  }

  getWebSockets(tag?: string): FakeSocket[] {
    return this.sockets.filter(
      (socket) => socket.closed === null && (tag === undefined || socket.tags.includes(tag)),
    );
  }
}

class Edge {
  readonly rooms = new Map<string, Room>();
  now = NOW;
  readonly env: RoomEnv;

  constructor() {
    const namespace = {
      idFromName: (name: string) => name,
      get: (name: string) => ({
        fetch: (input: string | Request, init?: RequestInit) =>
          this.call(name, new Request(input, init)),
      }),
    };
    this.env = {
      ROOMS: namespace as unknown as DurableObjectNamespace,
      ROOM_TOKEN_KEY: SECRET,
    };
  }

  room(name: string): Room {
    let room = this.rooms.get(name);
    if (room === undefined) {
      room = new Room(new FakeState() as unknown as DurableObjectState, this.env);
      room.now = () => this.now;
      this.rooms.set(name, room);
    }
    return room;
  }

  state(name: string): FakeState {
    return this.room(name).ctx as unknown as FakeState;
  }

  private async call(name: string, request: Request): Promise<Response> {
    const room = this.room(name);
    if (new URL(request.url).pathname === "/connect") {
      const seat = JSON.parse(request.headers.get("X-Room-Seat") ?? "") as Seat;
      if (room.isFull(seat)) {
        return room.fetch(request);
      }
      const socket = new FakeSocket();
      await room.join(socket as unknown as WebSocket, seat);
      return new Response(JSON.stringify({ room: name }), {
        headers: { "Sec-WebSocket-Protocol": request.headers.get("X-Room-Protocol") ?? "" },
      });
    }
    return room.fetch(request);
  }

  async token(grant: Partial<RoomGrant> = {}): Promise<string> {
    return signRoomToken(
      {
        tenant: TENANT,
        room: SLIDE,
        user: ANNA,
        project: PROJECT,
        expires: this.now + 300,
        ...grant,
      },
      await roomKey(SECRET),
    );
  }

  async connect(room: string, protocols: string | null, upgrade = "websocket"): Promise<Response> {
    const headers = new Headers({ Upgrade: upgrade });
    if (protocols !== null) {
      headers.set("Sec-WebSocket-Protocol", protocols);
    }
    return handleRealtime(
      new Request(`https://parfocal.test/rt/${room}`, { headers }),
      this.env,
      () => this.now,
    );
  }

  async join(grant: Partial<RoomGrant>): Promise<FakeSocket> {
    const room = grant.room ?? SLIDE;
    const response = await this.connect(room, `${ROOM_PROTOCOL}, ${await this.token(grant)}`);
    assert.equal(response.status, 200, await response.clone().text());
    const state = this.state(`${grant.tenant ?? TENANT}/${room}`);
    const socket = state.sockets.at(-1);
    assert.ok(socket);
    return socket;
  }

  async internal(action: string, body: unknown, signature?: string): Promise<Response> {
    const text = JSON.stringify(body);
    const header = signature ?? (await signPublish(await roomKey(SECRET), this.now, text));
    return handleRealtime(
      new Request(`https://parfocal.test/rt-internal/${action}`, {
        method: "POST",
        body: text,
        headers: { [PUBLISH_HEADER]: header },
      }),
      this.env,
      () => this.now,
    );
  }

  publish(tenant: string, rooms: string[], kind = "slide.changed") {
    return this.internal("publish", {
      tenant,
      rooms,
      event: { kind, ids: { slide: SLIDE.slice(6) } },
    });
  }
}

async function problemCode(response: Response): Promise<string> {
  const body: { code: string } = await response.json();
  return body.code;
}

describe("room tokens", () => {
  test("the edge accepts the token the API signs in the shared vector", async () => {
    const decision = await verifyRoomToken(vector.token, await roomKey(SECRET), NOW - 1);
    assert.deepEqual(decision, {
      ok: true,
      grant: {
        tenant: vector.claims.t,
        room: vector.claims.r,
        user: vector.claims.u,
        project: vector.claims.p,
        expires: vector.claims.e,
      },
    });
    const [tenant, room, user, project] = [
      vector.claims.t,
      vector.claims.r,
      vector.claims.u,
      vector.claims.p,
    ];
    assert.equal(
      await signRoomToken(
        { tenant, room, user, project, expires: vector.claims.e },
        await roomKey(SECRET),
      ),
      vector.token,
    );
  });

  test("an expired, forged or tile token is refused", async () => {
    const key = await roomKey(SECRET);
    assert.deepEqual(await verifyRoomToken(vector.token, key, NOW), {
      ok: false,
      reason: "expired",
    });
    const forged = `${vector.token.split(".")[0]}.${"A".repeat(43)}`;
    assert.equal((await verifyRoomToken(forged, key, NOW - 1)).ok, false);
    const tile = await signCapability(
      {
        tenant: TENANT,
        slide: SLIDE.slice(6),
        original: "original.svs",
        size: 1,
        restricted: [],
        expires: NOW + 60,
      },
      await signingKey(SECRET),
    );
    assert.deepEqual(await verifyRoomToken(tile, key, NOW), { ok: false, reason: "malformed" });
  });

  test("the publish signature matches the shared vector and expires after a minute", async () => {
    const key = await roomKey(SECRET);
    const { stamp, body, signature } = vector.publish;
    assert.equal(await signPublish(key, stamp, body), signature);
    assert.equal(await verifyPublish(key, signature, body, stamp + 60), true);
    assert.equal(await verifyPublish(key, signature, body, stamp + 61), false);
    assert.equal(await verifyPublish(key, signature, `${body} `, stamp), false);
    assert.equal(await verifyPublish(key, null, body, stamp), false);
  });
});

describe("joining a room", () => {
  test("a valid token joins the room named by its tenant and room", async () => {
    const edge = new Edge();
    const socket = await edge.join({});
    assert.deepEqual(socket.deserializeAttachment(), {
      tenant: TENANT,
      room: SLIDE,
      user: ANNA,
      project: PROJECT,
      expires: NOW + 300,
    } satisfies Seat);
    assert.equal(edge.state(`${TENANT}/${SLIDE}`).alarm, (NOW + 300) * 1000);
    assert.deepEqual(
      [...edge.state(`${TENANT}/user:${ANNA}`).stored.values()],
      [{ room: SLIDE, project: PROJECT, expires: NOW + 300 }],
    );
  });

  test("the edge refuses a missing, expired, forged or other room's token", async () => {
    const edge = new Edge();
    assert.equal(await problemCode(await edge.connect(SLIDE, null)), "room-token-missing");
    assert.equal(
      await problemCode(
        await edge.connect(SLIDE, `${ROOM_PROTOCOL}, ${await edge.token({ expires: NOW })}`),
      ),
      "room-token-expired",
    );
    const forged = `${(await edge.token()).split(".")[0]}.${"A".repeat(43)}`;
    assert.equal(
      await problemCode(await edge.connect(SLIDE, `${ROOM_PROTOCOL}, ${forged}`)),
      "room-token-invalid",
    );
    const other = await edge.connect(OTHER_SLIDE, `${ROOM_PROTOCOL}, ${await edge.token()}`);
    assert.equal(other.status, 403);
    assert.equal(await problemCode(other), "room-token-other-room");
    const plain = await edge.connect(SLIDE, `${ROOM_PROTOCOL}, ${await edge.token()}`, "");
    assert.equal(plain.status, 426);
    assert.equal((await edge.connect("case:1", null)).status, 404);
    assert.equal(edge.rooms.size, 0);
  });
});

describe("fan-out", () => {
  test("a user never receives another tenant's events, even in a room with the same name", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    const outsider = await edge.join({ tenant: OTHER_TENANT, user: BEN });
    const response = await edge.publish(TENANT, [SLIDE]);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(anna.events(), [{ kind: "slide.changed", ids: { slide: SLIDE.slice(6) } }]);
    assert.deepEqual(outsider.events(), []);
    await edge.publish(OTHER_TENANT, [OTHER_SLIDE]);
    assert.equal(anna.events().length, 1);
    assert.deepEqual(outsider.events(), []);
  });

  test("events carry ids and kinds only and need the API's signature", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    const named = await edge.internal("publish", {
      tenant: TENANT,
      rooms: [SLIDE],
      event: { kind: "case.renamed", ids: { patient: "Jana Nováková" } },
    });
    assert.equal(named.status, 400);
    const unsigned = await edge.internal(
      "publish",
      { tenant: TENANT, rooms: [SLIDE], event: { kind: "slide.changed", ids: {} } },
      `${NOW}.${"A".repeat(43)}`,
    );
    assert.equal(unsigned.status, 401);
    const stale = await edge.internal(
      "publish",
      { tenant: TENANT, rooms: [SLIDE], event: { kind: "slide.changed", ids: {} } },
      await signPublish(
        await roomKey(SECRET),
        NOW - 120,
        JSON.stringify({
          tenant: TENANT,
          rooms: [SLIDE],
          event: { kind: "slide.changed", ids: {} },
        }),
      ),
    );
    assert.equal(stale.status, 401);
    assert.deepEqual(anna.events(), []);
  });

  test("a client frame is never passed on to the room", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    const ben = await edge.join({ user: BEN });
    anna.sent.length = 0;
    ben.sent.length = 0;
    const room = edge.room(`${TENANT}/${SLIDE}`);
    await room.webSocketMessage(
      anna as unknown as WebSocket,
      JSON.stringify({ type: "event", kind: "slide.changed", ids: {} }),
    );
    await room.webSocketMessage(anna as unknown as WebSocket, JSON.stringify({ type: "ping" }));
    assert.deepEqual(ben.sent, []);
    assert.deepEqual(anna.sent, [JSON.stringify({ type: "pong" })]);
    await room.webSocketMessage(anna as unknown as WebSocket, "x".repeat(5000));
    assert.equal(anna.closed?.code, CLOSE_TOO_BIG);
    assert.equal(ben.closed, null);
  });
});

describe("presence", () => {
  const joined = (user: string) => ({ kind: "presence.joined", ids: { user } });
  const left = (user: string) => ({ kind: "presence.left", ids: { user } });

  test("a newcomer learns who is here and the others learn of the newcomer", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    assert.deepEqual(anna.events(), []);
    const ben = await edge.join({ user: BEN });
    assert.deepEqual(anna.events(), [joined(BEN)]);
    assert.deepEqual(ben.events(), [joined(ANNA)]);
  });

  test("a second tab of the same person is not a new arrival or a departure", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    const benFirst = await edge.join({ user: BEN });
    const benSecond = await edge.join({ user: BEN });
    assert.deepEqual(anna.events(), [joined(BEN)]);
    assert.deepEqual(benSecond.events(), [joined(ANNA)]);
    const room = edge.room(`${TENANT}/${SLIDE}`);
    benFirst.close(1000, "left");
    await room.webSocketClose(benFirst as unknown as WebSocket, 1000);
    assert.deepEqual(anna.events(), [joined(BEN)]);
    benSecond.close(1000, "left");
    await room.webSocketClose(benSecond as unknown as WebSocket, 1000);
    assert.deepEqual(anna.events(), [joined(BEN), left(BEN)]);
  });

  test("leaving, expiry and removal each tell the others the person left", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    const ben = await edge.join({ user: BEN, expires: NOW + 60 });
    const room = edge.room(`${TENANT}/${SLIDE}`);
    edge.now = NOW + 61;
    await room.alarm();
    assert.equal(ben.closed?.code, CLOSE_EXPIRED);
    assert.deepEqual(anna.events(), [joined(BEN), left(BEN)]);
    edge.now = NOW;
    const again = await edge.join({ user: BEN });
    await edge.internal("revoke", { tenant: TENANT, user: BEN, project: null });
    assert.equal(again.closed?.code, CLOSE_REMOVED);
    assert.deepEqual(anna.events(), [joined(BEN), left(BEN), joined(BEN), left(BEN)]);
    assert.deepEqual(again.events(), [joined(ANNA)]);
  });

  test("the project room learns which slide each person is viewing", async () => {
    const edge = new Edge();
    const projectRoom = `project:${PROJECT}`;
    const slideId = SLIDE.slice(6);
    await edge.join({});
    const watcher = await edge.join({ room: projectRoom, user: BEN });
    assert.deepEqual(watcher.events(), [
      { kind: "presence.joined", ids: { slide: slideId, user: ANNA } },
    ]);
    const late = await edge.join({ room: projectRoom, user: BEN });
    assert.deepEqual(late.events(), [
      { kind: "presence.joined", ids: { slide: slideId, user: ANNA } },
    ]);
    const anna = edge.state(`${TENANT}/${SLIDE}`).sockets[0];
    assert.ok(anna);
    anna.close(1000, "left");
    await edge.room(`${TENANT}/${SLIDE}`).webSocketClose(anna as unknown as WebSocket, 1000);
    assert.deepEqual(watcher.events().at(-1), {
      kind: "presence.left",
      ids: { slide: slideId, user: ANNA },
    });
    assert.deepEqual([...edge.state(`${TENANT}/${projectRoom}`).stored.keys()], []);
  });

  test("presence stays inside its tenant", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    const outsider = await edge.join({ tenant: OTHER_TENANT, user: BEN });
    assert.deepEqual(anna.events(), []);
    assert.deepEqual(outsider.events(), []);
  });
});

describe("expiry and removal", () => {
  test("a socket closes when its token expires unless the client renews it", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    const ben = await edge.join({ user: BEN });
    const room = edge.room(`${TENANT}/${SLIDE}`);
    edge.now += 200;
    await room.webSocketMessage(
      ben as unknown as WebSocket,
      JSON.stringify({ type: "renew", token: await edge.token({ user: BEN }) }),
    );
    assert.equal((JSON.parse(ben.sent.at(-1) ?? "") as { type: string }).type, "renewed");
    edge.now += 100;
    await room.alarm();
    assert.deepEqual(anna.closed, { code: CLOSE_EXPIRED, reason: "token-expired" });
    assert.equal(ben.closed, null);
    assert.equal(edge.state(`${TENANT}/${SLIDE}`).alarm, (NOW + 500) * 1000);
  });

  test("a renewal for another user or room closes the socket", async () => {
    const edge = new Edge();
    const anna = await edge.join({});
    await edge
      .room(`${TENANT}/${SLIDE}`)
      .webSocketMessage(
        anna as unknown as WebSocket,
        JSON.stringify({ type: "renew", token: await edge.token({ room: OTHER_SLIDE }) }),
      );
    assert.equal(anna.closed?.code, CLOSE_EXPIRED);
  });

  test("removal from a project closes that project's sockets and keeps the rest", async () => {
    const edge = new Edge();
    const slide = await edge.join({});
    const otherProject = await edge.join({
      room: OTHER_SLIDE,
      project: "88888888-8888-4888-8888-888888888888",
    });
    const own = await edge.join({ room: `user:${ANNA}`, project: null });
    const ben = await edge.join({ user: BEN });
    const response = await edge.internal("revoke", {
      tenant: TENANT,
      user: ANNA,
      project: PROJECT,
    });
    assert.deepEqual(await response.json(), { rooms: 1 });
    assert.deepEqual(slide.closed, { code: CLOSE_REMOVED, reason: "removed" });
    assert.equal(otherProject.closed, null);
    assert.equal(own.closed, null);
    assert.equal(ben.closed, null);
  });

  test("removal from the workspace closes every socket the person holds", async () => {
    const edge = new Edge();
    const sockets = [
      await edge.join({}),
      await edge.join({ room: OTHER_SLIDE }),
      await edge.join({ room: `user:${ANNA}`, project: null }),
    ];
    const outsider = await edge.join({ tenant: OTHER_TENANT });
    await edge.internal("revoke", { tenant: TENANT, user: ANNA, project: null });
    assert.deepEqual(
      sockets.map((socket) => socket.closed?.code),
      [CLOSE_REMOVED, CLOSE_REMOVED, CLOSE_REMOVED],
    );
    assert.equal(outsider.closed, null);
  });
});

describe("rooms after a removal", () => {
  const frame = (type: string, token: string) => JSON.stringify({ type, token });

  test("a removed person cannot rejoin with the token they still hold", async () => {
    const edge = new Edge();
    const held = `${ROOM_PROTOCOL}, ${await edge.token()}`;
    assert.equal((await edge.connect(SLIDE, held)).status, 200);
    const ben = await edge.join({ user: BEN });
    await edge.internal("revoke", { tenant: TENANT, user: ANNA, project: PROJECT });
    edge.now = NOW + 30;
    const again = await edge.connect(SLIDE, held);
    assert.equal(again.status, 403);
    assert.equal(await problemCode(again), "room-access-revoked");
    const state = edge.state(`${TENANT}/${SLIDE}`);
    assert.equal(state.sockets.length, 2);
    assert.deepEqual(state.getWebSockets(), [ben]);
    const sent = await edge.publish(TENANT, [SLIDE]);
    assert.deepEqual(await sent.json(), { rooms: 1 });
    assert.equal(ben.events().at(-1)?.kind, "slide.changed");
  });

  test("a token issued after the removal joins again", async () => {
    const edge = new Edge();
    await edge.join({});
    await edge.internal("revoke", { tenant: TENANT, user: ANNA, project: PROJECT });
    edge.now = NOW + 1;
    const back = await edge.join({});
    assert.equal(back.closed, null);
  });

  test("removal from one project leaves the tokens of other projects and of no project alone", async () => {
    const edge = new Edge();
    const other = `${ROOM_PROTOCOL}, ${await edge.token({
      room: OTHER_SLIDE,
      project: "88888888-8888-4888-8888-888888888888",
    })}`;
    const own = `${ROOM_PROTOCOL}, ${await edge.token({ room: `user:${ANNA}`, project: null })}`;
    await edge.join({});
    await edge.internal("revoke", { tenant: TENANT, user: ANNA, project: PROJECT });
    assert.equal((await edge.connect(OTHER_SLIDE, other)).status, 200);
    assert.equal((await edge.connect(`user:${ANNA}`, own)).status, 200);
  });

  test("removal from the workspace refuses every token held before it", async () => {
    const edge = new Edge();
    const own = `${ROOM_PROTOCOL}, ${await edge.token({ room: `user:${ANNA}`, project: null })}`;
    const never = `${ROOM_PROTOCOL}, ${await edge.token({ room: OTHER_SLIDE })}`;
    await edge.join({});
    await edge.internal("revoke", { tenant: TENANT, user: ANNA, project: null });
    assert.equal(await problemCode(await edge.connect(`user:${ANNA}`, own)), "room-access-revoked");
    assert.equal(await problemCode(await edge.connect(OTHER_SLIDE, never)), "room-access-revoked");
    const ben = await edge.join({ user: BEN });
    assert.equal(ben.closed, null);
  });

  test("an older token joining later does not hide a newer socket from a removal", async () => {
    const edge = new Edge();
    const older = `${ROOM_PROTOCOL}, ${await edge.token()}`;
    const first = await edge.join({});
    edge.now = NOW + 150;
    first.sent.length = 0;
    await edge
      .room(`${TENANT}/${SLIDE}`)
      .webSocketMessage(first as unknown as WebSocket, frame("renew", await edge.token()));
    assert.equal((JSON.parse(first.sent.at(-1) ?? "") as { type: string }).type, "renewed");
    assert.equal((await edge.connect(SLIDE, older)).status, 200);
    edge.now = NOW + 310;
    await edge.internal("revoke", { tenant: TENANT, user: ANNA, project: PROJECT });
    assert.deepEqual(first.closed, { code: CLOSE_REMOVED, reason: "removed" });
  });

  test("a renewal with a token held before the removal closes the socket as removed", async () => {
    const edge = new Edge();
    const held = await edge.token();
    await edge.internal("revoke", { tenant: TENANT, user: ANNA, project: PROJECT });
    const room = edge.room(`${TENANT}/${SLIDE}`);
    const missed = new FakeSocket();
    await room.join(missed as unknown as WebSocket, {
      tenant: TENANT,
      room: SLIDE,
      user: ANNA,
      project: PROJECT,
      expires: NOW + 300,
    });
    edge.now = NOW + 100;
    await room.webSocketMessage(missed as unknown as WebSocket, frame("renew", held));
    assert.deepEqual(missed.closed, { code: CLOSE_REMOVED, reason: "removed" });
    assert.equal(
      missed.sent.some((text) => text.includes("renewed")),
      false,
    );
  });

  test("a join is refused when the person's room index cannot be written", async () => {
    const edge = new Edge();
    const index = edge.room(`${TENANT}/user:${ANNA}`);
    index.remember = () => Promise.reject(new Error("storage is down"));
    await assert.rejects(edge.connect(SLIDE, `${ROOM_PROTOCOL}, ${await edge.token()}`));
    assert.equal(edge.state(`${TENANT}/${SLIDE}`).sockets.length, 0);
  });

  test("the edge and the API agree on how long a room token lives", () => {
    const api = readFileSync(
      `${import.meta.dirname}/../../api/src/parfocal_api/room_access.py`,
      "utf8",
    );
    assert.match(api, /^ROOM_TOKEN_SECONDS = 5 \* 60$/m);
    assert.equal(ROOM_TOKEN_SECONDS, 300);
  });
});

describe("room caps", () => {
  function streamed(chunks: number, size: number) {
    const pulled = { chunks: 0 };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulled.chunks === chunks) {
            controller.close();
            return;
          }
          pulled.chunks += 1;
          controller.enqueue(new Uint8Array(size).fill(0x20));
        },
      },
      { highWaterMark: 0 },
    );
    return { body, pulled };
  }

  function internalCall(edge: Edge, body: ReadableStream<Uint8Array>, headers: HeadersInit) {
    return handleRealtime(
      new Request("https://parfocal.test/rt-internal/publish", {
        method: "POST",
        body,
        headers,
        duplex: "half",
      } as RequestInit),
      edge.env,
      () => edge.now,
    );
  }

  test("the ninth socket of one person in one room is refused", async () => {
    const edge = new Edge();
    const sockets: FakeSocket[] = [];
    for (let count = 0; count < MAX_SOCKETS_PER_PERSON; count += 1) {
      sockets.push(await edge.join({}));
    }
    assert.equal(MAX_SOCKETS_PER_PERSON, 8);
    const ninth = await edge.connect(SLIDE, `${ROOM_PROTOCOL}, ${await edge.token()}`);
    assert.equal(ninth.status, 429);
    assert.equal(await problemCode(ninth), "room-full");
    assert.equal(edge.state(`${TENANT}/${SLIDE}`).sockets.length, 8);
    const ben = await edge.join({ user: BEN });
    assert.equal(ben.closed, null);
    const elsewhere = await edge.join({ room: OTHER_SLIDE });
    assert.equal(elsewhere.closed, null);
    sockets[0]?.close(1000, "left");
    const again = await edge.join({});
    assert.equal(again.closed, null);
  });

  test("an internal call with no usable signature header is refused before the body is read", async () => {
    const edge = new Edge();
    for (const headers of [{}, { [PUBLISH_HEADER]: "not a signature" }]) {
      const { body, pulled } = streamed(4, 1024);
      const response = await internalCall(edge, body, headers);
      assert.equal(response.status, 401);
      assert.equal(await problemCode(response), "publish-signature-invalid");
      assert.equal(pulled.chunks, 0);
    }
  });

  test("an oversized internal call is refused before the rest of the body is read", async () => {
    const edge = new Edge();
    const signature = `${NOW}.${"A".repeat(43)}`;
    const declared = streamed(4, 1024);
    const tooLong = await internalCall(edge, declared.body, {
      [PUBLISH_HEADER]: signature,
      "Content-Length": String(MAX_INTERNAL_BODY + 1),
    });
    assert.equal(tooLong.status, 413);
    assert.equal(await problemCode(tooLong), "publish-too-large");
    assert.equal(declared.pulled.chunks, 0);

    const chunk = 16 * 1024;
    const endless = streamed(1024, chunk);
    const flooded = await internalCall(edge, endless.body, { [PUBLISH_HEADER]: signature });
    assert.equal(flooded.status, 413);
    assert.ok(endless.pulled.chunks * chunk <= MAX_INTERNAL_BODY + 2 * chunk);

    const small = streamed(2, 1024);
    const unsigned = await internalCall(edge, small.body, { [PUBLISH_HEADER]: signature });
    assert.equal(unsigned.status, 401);
  });
});

describe("follow my view", () => {
  const view = (fields: Record<string, unknown>) => JSON.stringify({ type: "view", ...fields });
  const camera = { x: 1200.5, y: 800.25, zoom: -2.5 };

  async function pair(grant: Partial<RoomGrant> = {}) {
    const edge = new Edge();
    const anna = await edge.join(grant);
    const ben = await edge.join({ ...grant, user: BEN });
    const room = edge.room(`${TENANT}/${grant.room ?? SLIDE}`);
    anna.sent.length = 0;
    ben.sent.length = 0;
    const say = (text: string) => room.webSocketMessage(anna as unknown as WebSocket, text);
    return { edge, anna, ben, room, say };
  }

  test("a view frame reaches the others in the slide room under the sender's own name", async () => {
    const { edge, anna, ben, say } = await pair();
    const secondTab = await edge.join({});
    secondTab.sent.length = 0;
    await say(view({ ...camera, user: BEN, note: "text" }));
    assert.deepEqual(ben.sent, [view({ user: ANNA, ...camera })]);
    assert.deepEqual(anna.sent, []);
    assert.deepEqual(secondTab.sent, []);
    await say(view({ stop: true }));
    assert.deepEqual(ben.sent.at(-1), view({ user: ANNA, stop: true }));
  });

  test("a view frame that is not three finite numbers, or is too long, is dropped", async () => {
    const { anna, ben, say } = await pair();
    await say(view({ x: 1, y: 2 }));
    await say(view({ x: "1", y: 2, zoom: 3 }));
    await say(view({ x: null, y: 2, zoom: 3 }));
    await say(view({ ...camera, padding: "p".repeat(200) }));
    assert.deepEqual(ben.sent, []);
    assert.equal(anna.closed, null);
  });

  test("a room that is not a slide room passes no view on", async () => {
    const { ben, say } = await pair({ room: "task:33333333-3333-4333-8333-333333333333" });
    await say(view(camera));
    assert.deepEqual(ben.sent, []);
  });

  test("view frames past the rate for one socket are dropped until the next second", async () => {
    const { ben, room, say } = await pair();
    let at = 5000;
    room.clock = () => at;
    for (let sent = 0; sent < MAX_VIEW_FRAMES_PER_SECOND + 10; sent += 1) {
      await say(view(camera));
    }
    assert.equal(ben.sent.length, MAX_VIEW_FRAMES_PER_SECOND);
    at += 1000;
    await say(view(camera));
    assert.equal(ben.sent.length, MAX_VIEW_FRAMES_PER_SECOND + 1);
  });

  test("an expired seat neither sends nor receives a view", async () => {
    const edge = new Edge();
    const anna = await edge.join({ expires: NOW + 900 });
    const ben = await edge.join({ user: BEN });
    const room = edge.room(`${TENANT}/${SLIDE}`);
    edge.now = NOW + 400;
    anna.sent.length = 0;
    ben.sent.length = 0;
    await room.webSocketMessage(anna as unknown as WebSocket, view(camera));
    assert.deepEqual(ben.sent, []);
    await room.webSocketMessage(ben as unknown as WebSocket, view(camera));
    assert.deepEqual(anna.sent, []);
  });

  test("nothing about a view is stored", async () => {
    const { edge, say } = await pair();
    const state = edge.state(`${TENANT}/${SLIDE}`);
    const before = JSON.stringify([...state.stored]);
    await say(view(camera));
    assert.equal(JSON.stringify([...state.stored]), before);
  });
});

describe("live shared cursor", () => {
  const cursor = (fields: Record<string, unknown>) => JSON.stringify({ type: "cursor", ...fields });
  const view = JSON.stringify({ type: "view", x: 1, y: 2, zoom: 3 });
  const point = { x: 0.4125, y: 0.73 };

  async function pair(grant: Partial<RoomGrant> = {}) {
    const edge = new Edge();
    const anna = await edge.join(grant);
    const ben = await edge.join({ ...grant, user: BEN });
    const room = edge.room(`${TENANT}/${grant.room ?? SLIDE}`);
    anna.sent.length = 0;
    ben.sent.length = 0;
    const say = (text: string) => room.webSocketMessage(anna as unknown as WebSocket, text);
    return { edge, anna, ben, room, say };
  }

  test("a cursor frame reaches the others in the slide room under the sender's own name", async () => {
    const { edge, anna, ben, say } = await pair();
    const secondTab = await edge.join({});
    secondTab.sent.length = 0;
    await say(cursor({ ...point, user: BEN, n: "t" }));
    assert.deepEqual(ben.sent, [cursor({ user: ANNA, ...point })]);
    assert.deepEqual(anna.sent, []);
    assert.deepEqual(secondTab.sent, []);
    await say(cursor({ gone: true }));
    assert.deepEqual(ben.sent.at(-1), cursor({ user: ANNA, gone: true }));
  });

  test("a cursor frame that is not two finite numbers, or is too long, is dropped", async () => {
    const { anna, ben, say } = await pair();
    await say(cursor({ x: 1 }));
    await say(cursor({ x: "1", y: 2 }));
    await say(cursor({ x: null, y: 2 }));
    await say(cursor({ ...point, padding: "p".repeat(100) }));
    assert.deepEqual(ben.sent, []);
    assert.equal(anna.closed, null);
  });

  test("a room that is not a slide room passes no cursor on", async () => {
    const { ben, say } = await pair({ room: "task:33333333-3333-4333-8333-333333333333" });
    await say(cursor(point));
    assert.deepEqual(ben.sent, []);
  });

  test("cursor frames past the rate are dropped and never use up the rate of view frames", async () => {
    const { ben, room, say } = await pair();
    let at = 5000;
    room.clock = () => at;
    for (let sent = 0; sent < MAX_CURSOR_FRAMES_PER_SECOND + 10; sent += 1) {
      await say(cursor(point));
    }
    assert.equal(ben.sent.length, MAX_CURSOR_FRAMES_PER_SECOND);
    await say(view);
    assert.equal(ben.sent.length, MAX_CURSOR_FRAMES_PER_SECOND + 1);
    at += 1000;
    await say(cursor(point));
    assert.equal(ben.sent.length, MAX_CURSOR_FRAMES_PER_SECOND + 2);
  });

  test("an expired seat neither sends nor receives a cursor", async () => {
    const edge = new Edge();
    const anna = await edge.join({ expires: NOW + 900 });
    const ben = await edge.join({ user: BEN });
    const room = edge.room(`${TENANT}/${SLIDE}`);
    edge.now = NOW + 400;
    anna.sent.length = 0;
    ben.sent.length = 0;
    await room.webSocketMessage(anna as unknown as WebSocket, cursor(point));
    assert.deepEqual(ben.sent, []);
    await room.webSocketMessage(ben as unknown as WebSocket, cursor(point));
    assert.deepEqual(anna.sent, []);
  });

  test("nothing about a cursor is stored", async () => {
    const { edge, say } = await pair();
    const state = edge.state(`${TENANT}/${SLIDE}`);
    const before = JSON.stringify([...state.stored]);
    await say(cursor(point));
    assert.equal(JSON.stringify([...state.stored]), before);
  });
});
