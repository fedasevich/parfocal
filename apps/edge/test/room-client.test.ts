import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_RETRY_MS,
  ROOM_PROTOCOL,
  RoomClient,
  type RoomTicket,
  retryDelay,
  type SocketLike,
  type Timers,
} from "../src/room-client.ts";

class ManualTimers implements Timers {
  now = 0;
  private next = 1;
  private readonly pending = new Map<number, { at: number; run: () => void }>();

  set(run: () => void, ms: number): number {
    const handle = this.next++;
    this.pending.set(handle, { at: this.now + ms, run });
    return handle;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  async advance(ms: number): Promise<void> {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.pending].filter(([, timer]) => timer.at <= until);
      due.sort(([, a], [, b]) => a.at - b.at);
      const first = due[0];
      if (first === undefined) {
        break;
      }
      this.pending.delete(first[0]);
      this.now = first[1].at;
      first[1].run();
      await settle();
    }
    this.now = until;
  }
}

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: ((close: { code: number }) => void) | null = null;
  readonly sent: string[] = [];
  closedWith: number | null = null;
  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closedWith = code;
  }

  drop(code: number): void {
    this.onclose?.({ code });
  }

  event(kind: string): void {
    this.onmessage?.({ data: JSON.stringify({ type: "event", kind, ids: {} }) });
  }
}

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await Promise.resolve();
  }
}

class Harness {
  readonly timers = new ManualTimers();
  readonly sockets: FakeSocket[] = [];
  serverVersion = 1;
  allowed = true;
  view: number | null = null;
  tickets = 0;
  refetches = 0;
  ended: string[] = [];
  signals: unknown[] = [];
  readonly client: RoomClient;

  constructor() {
    this.client = new RoomClient({
      url: "wss://parfocal.test/rt/slide:1",
      ticket: () => {
        this.tickets += 1;
        return Promise.resolve<RoomTicket | null>(
          this.allowed ? { token: `token-${this.tickets}`, lifetimeSeconds: 300 } : null,
        );
      },
      open: (url, protocols) => {
        const socket = new FakeSocket(url, protocols);
        this.sockets.push(socket);
        return socket;
      },
      refetch: () => {
        this.refetches += 1;
        this.view = this.serverVersion;
      },
      onEvent: () => {
        this.view = this.serverVersion;
      },
      onSignal: (signal) => this.signals.push(signal),
      onEnded: (reason) => this.ended.push(reason),
      timers: this.timers,
    });
  }

  get socket(): FakeSocket {
    const socket = this.sockets.at(-1);
    assert.ok(socket);
    return socket;
  }

  async start(): Promise<void> {
    this.client.start();
    await settle();
    this.socket.onopen?.();
    await settle();
  }
}

describe("room client", () => {
  test("a client offers the token as a subprotocol and refetches once it is in the room", async () => {
    const harness = new Harness();
    await harness.start();
    assert.deepEqual(harness.socket.protocols, [ROOM_PROTOCOL, "token-1"]);
    assert.equal(harness.refetches, 1);
    assert.equal(harness.view, 1);
  });

  test("a reconnecting client refetches and converges on changes it missed", async () => {
    const harness = new Harness();
    await harness.start();
    harness.serverVersion = 2;
    harness.socket.event("slide.changed");
    assert.equal(harness.view, 2);
    harness.socket.drop(1006);
    harness.serverVersion = 3;
    harness.serverVersion = 4;
    await harness.timers.advance(retryDelay(0));
    assert.equal(harness.sockets.length, 2);
    assert.equal(harness.view, 2);
    harness.socket.onopen?.();
    await settle();
    assert.equal(harness.view, 4);
    assert.equal(harness.tickets, 2);
    assert.equal(harness.refetches, 2);
  });

  test("retries back off and the next token is asked for each time", async () => {
    const harness = new Harness();
    await harness.start();
    harness.socket.drop(1006);
    await harness.timers.advance(retryDelay(0));
    harness.socket.drop(1006);
    await harness.timers.advance(retryDelay(1) - 1);
    assert.equal(harness.sockets.length, 2);
    await harness.timers.advance(1);
    assert.equal(harness.sockets.length, 3);
    assert.equal(retryDelay(20), MAX_RETRY_MS);
  });

  test("a client that may no longer read the room stops instead of retrying", async () => {
    const harness = new Harness();
    await harness.start();
    harness.allowed = false;
    harness.socket.drop(4403);
    await harness.timers.advance(MAX_RETRY_MS * 4);
    assert.equal(harness.sockets.length, 1);
    assert.deepEqual(harness.ended, ["no-access"]);
  });

  test("a client renews its token on the open socket at half its lifetime", async () => {
    const harness = new Harness();
    await harness.start();
    await harness.timers.advance(150_000);
    assert.deepEqual(harness.socket.sent, [JSON.stringify({ type: "renew", token: "token-2" })]);
    harness.allowed = false;
    await harness.timers.advance(150_000);
    assert.equal(harness.socket.closedWith, 1000);
    assert.deepEqual(harness.ended, ["no-access"]);
  });

  test("a stopped client does not reconnect", async () => {
    const harness = new Harness();
    await harness.start();
    harness.client.stop();
    harness.socket.drop(1000);
    await harness.timers.advance(MAX_RETRY_MS);
    assert.equal(harness.sockets.length, 1);
    assert.equal(harness.socket.closedWith, 1000);
  });

  test("a client sends a signal only on an open socket and hears other people's signals", async () => {
    const harness = new Harness();
    assert.equal(harness.client.send({ type: "view", x: 1, y: 2, zoom: 3 }), false);
    harness.client.start();
    await settle();
    assert.equal(harness.client.send({ type: "view", x: 1, y: 2, zoom: 3 }), false);
    harness.socket.onopen?.();
    assert.equal(harness.client.send({ type: "view", x: 1, y: 2, zoom: 3 }), true);
    assert.deepEqual(harness.socket.sent, [JSON.stringify({ type: "view", x: 1, y: 2, zoom: 3 })]);
    const heard = { type: "view", user: "ben", x: 4, y: 5, zoom: 6 };
    harness.socket.onmessage?.({ data: JSON.stringify(heard) });
    harness.socket.onmessage?.({ data: JSON.stringify({ type: "pong" }) });
    harness.socket.onmessage?.({ data: JSON.stringify({ type: "renewed", expires: 1 }) });
    harness.socket.onmessage?.({ data: "[1]" });
    harness.socket.event("slide.changed");
    assert.deepEqual(harness.signals, [heard]);
  });
});
