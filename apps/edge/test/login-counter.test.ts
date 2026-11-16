import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { LOGIN_WINDOW_MS, LOGINS_PER_WINDOW, LoginCounter } from "../src/login-counter.ts";
import { guard, type LimitEnv } from "../src/rate-limits.ts";

const ORIGIN = "https://parfocal.test";
const START = 1_800_000_000_000;

class FakeState {
  readonly stored = new Map<string, unknown>();
  alarm: number | null = null;

  readonly storage = {
    get: (key: string) => Promise.resolve(structuredClone(this.stored.get(key))),
    put: (key: string, value: unknown) => {
      this.stored.set(key, structuredClone(value));
      return Promise.resolve();
    },
    setAlarm: (when: number) => {
      this.alarm = when;
      return Promise.resolve();
    },
    deleteAll: () => {
      this.stored.clear();
      return Promise.resolve();
    },
  };
}

class Counters {
  now = START;
  readonly objects = new Map<string, { counter: LoginCounter; state: FakeState }>();
  readonly namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: (input: string, init?: RequestInit) =>
        this.object(name).counter.fetch(new Request(input, init)),
    }),
  } as unknown as DurableObjectNamespace;

  object(name: string): { counter: LoginCounter; state: FakeState } {
    let entry = this.objects.get(name);
    if (entry === undefined) {
      const state = new FakeState();
      const counter = new LoginCounter(state as unknown as DurableObjectState, {});
      counter.clock = () => this.now;
      entry = { counter, state };
      this.objects.set(name, entry);
    }
    return entry;
  }
}

function looseLimit(): RateLimit {
  return { limit: () => Promise.resolve({ success: true }) };
}

function login(address: string): Request {
  return new Request(`${ORIGIN}/api/auth/login?return_to=/`, {
    headers: { "CF-Connecting-IP": address },
  });
}

async function statusOf(env: LimitEnv, address: string): Promise<number> {
  return (await guard(login(address), env))?.status ?? 200;
}

describe("the strict login counter", () => {
  test("request 11 within a minute gets 429 while another address is let through", async () => {
    const counters = new Counters();
    const env: LimitEnv = { LOGIN_LIMIT: looseLimit(), LOGIN_COUNTER: counters.namespace };
    const statuses: number[] = [];
    for (let attempt = 0; attempt < LOGINS_PER_WINDOW + 1; attempt += 1) {
      counters.now = START + attempt * 1000;
      statuses.push(await statusOf(env, "198.51.100.7"));
    }
    assert.deepEqual(statuses, [...Array<number>(LOGINS_PER_WINDOW).fill(200), 429]);
    const refused = await guard(login("198.51.100.7"), env);
    assert.equal(refused?.status, 429);
    assert.equal(refused?.headers.get("Retry-After"), "50");
    assert.equal(await statusOf(env, "2001:db8::7"), 200);
    assert.deepEqual([...counters.objects.keys()], ["login:198.51.100.7", "login:2001:db8::7"]);
  });

  test("a refused login does not extend the window, and the next window lets the address in", async () => {
    const counters = new Counters();
    const env: LimitEnv = { LOGIN_LIMIT: looseLimit(), LOGIN_COUNTER: counters.namespace };
    for (let attempt = 0; attempt < LOGINS_PER_WINDOW; attempt += 1) {
      assert.equal(await statusOf(env, "203.0.113.9"), 200);
    }
    counters.now = START + LOGIN_WINDOW_MS - 1;
    assert.equal(await statusOf(env, "203.0.113.9"), 429);
    counters.now = START + LOGIN_WINDOW_MS;
    assert.equal(await statusOf(env, "203.0.113.9"), 200);
  });

  test("the counter forgets the address when its alarm fires", async () => {
    const counters = new Counters();
    const env: LimitEnv = { LOGIN_LIMIT: looseLimit(), LOGIN_COUNTER: counters.namespace };
    assert.equal(await statusOf(env, "203.0.113.10"), 200);
    const { counter, state } = counters.object("login:203.0.113.10");
    assert.equal(state.alarm, START + LOGIN_WINDOW_MS);
    await counter.alarm();
    assert.equal(state.stored.size, 0);
  });

  test("the approximate binding still refuses first, before the counter is asked", async () => {
    const counters = new Counters();
    const env: LimitEnv = {
      LOGIN_LIMIT: { limit: () => Promise.resolve({ success: false }) },
      LOGIN_COUNTER: counters.namespace,
    };
    assert.equal(await statusOf(env, "203.0.113.11"), 429);
    assert.equal(counters.objects.size, 0);
  });

  test("other limited routes do not touch the login counter", async () => {
    const counters = new Counters();
    const env: LimitEnv = { TILE_LIMIT: looseLimit(), LOGIN_COUNTER: counters.namespace };
    const tile = new Request(`${ORIGIN}/tiles/slide/level-0.bin`, {
      headers: { "CF-Connecting-IP": "203.0.113.12" },
    });
    assert.equal(await guard(tile, env), null);
    assert.equal(counters.objects.size, 0);
  });

  test("every Worker binds the counter and exports its class", () => {
    const config = readFileSync(`${import.meta.dirname}/../wrangler.jsonc`, "utf8");
    const bindings = config.match(/"name": "LOGIN_COUNTER", "class_name": "LoginCounter"/g);
    assert.equal(bindings?.length, 3);
    assert.match(config, /"new_sqlite_classes": \["LoginCounter"\]/);
    const worker = readFileSync(`${import.meta.dirname}/../src/worker.ts`, "utf8");
    assert.match(worker, /export \{ LoginCounter \}/);
  });
});
