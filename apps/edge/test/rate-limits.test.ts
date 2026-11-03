import assert from "node:assert/strict";
import { describe, test } from "node:test";
import edge, { type EdgeEnv } from "../src/index.ts";
import {
  clientAddress,
  guard,
  type LimitEnv,
  limitClassOf,
  type Siteverify,
  TEST_ADDRESS_HEADER,
} from "../src/rate-limits.ts";

const ORIGIN = "https://parfocal.test";
const context = { waitUntil: () => undefined } as unknown as ExecutionContext;

function fakeLimit(limit: number): RateLimit & { readonly keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    limit: ({ key }) => {
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve({ success: count <= limit });
    },
  };
}

function from(address: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", address);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

function limits(login = 3, upload = 3, tile = 3) {
  return {
    LOGIN_LIMIT: fakeLimit(login),
    UPLOAD_LIMIT: fakeLimit(upload),
    TILE_LIMIT: fakeLimit(tile),
  };
}

describe("which requests are limited", () => {
  test("login and its callback, upload writes and tiles are limited, the rest is not", () => {
    assert.equal(limitClassOf("GET", "/api/auth/login"), "login");
    assert.equal(limitClassOf("GET", "/api/auth/callback"), "login");
    assert.equal(limitClassOf("POST", "/api/uploads"), "upload");
    assert.equal(limitClassOf("PUT", "/api/uploads/abc/parts"), "upload");
    assert.equal(limitClassOf("GET", "/api/uploads/abc/status"), null);
    assert.equal(limitClassOf("GET", "/tiles/slide/level-0.bin"), "tile");
    assert.equal(limitClassOf("GET", "/assets/index.js"), null);
    assert.equal(limitClassOf("GET", "/"), null);
    assert.equal(limitClassOf("POST", "/api/uploadsx"), null);
    assert.equal(limitClassOf("GET", "/api/auth/logout"), null);
  });

  test("the client address comes from CF-Connecting-IP and the test header only when trusted", () => {
    const request = from("203.0.113.1", "/", {
      headers: { [TEST_ADDRESS_HEADER]: "198.51.100.9" },
    });
    assert.equal(clientAddress(request, {}), "203.0.113.1");
    assert.equal(clientAddress(request, { TRUST_TEST_CLIENT_ADDRESS: "1" }), "203.0.113.1");
    assert.equal(clientAddress(request, { TRUST_TEST_CLIENT_ADDRESS: "true" }), "198.51.100.9");
    assert.equal(clientAddress(new Request(ORIGIN), {}), "unknown");
  });
});

describe("the edge limits", () => {
  test("a login flood from one address gets 429 while another address still signs in", async () => {
    const env = limits();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await guard(from("203.0.113.1", "/api/auth/login"), env);
      statuses.push(response?.status ?? 200);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
    assert.equal(await guard(from("198.51.100.2", "/api/auth/login"), env), null);
  });

  test("the 429 is a problem with Retry-After set to the window", async () => {
    const env = limits(0, 0, 0);
    const login = await guard(from("203.0.113.1", "/api/auth/login"), env);
    assert.ok(login);
    assert.equal(login.status, 429);
    assert.equal(login.headers.get("Retry-After"), "60");
    assert.equal(login.headers.get("Content-Type"), "application/problem+json");
    assert.equal(login.headers.get("Cache-Control"), "no-store");
    const body: { readonly code: string } = await login.json();
    assert.equal(body.code, "rate-limited");
    const tile = await guard(from("203.0.113.1", "/tiles/x"), env);
    assert.equal(tile?.headers.get("Retry-After"), "10");
  });

  test("each kind counts under its own key and assets are never counted", async () => {
    const env = limits();
    await guard(from("203.0.113.1", "/api/auth/login"), env);
    await guard(from("203.0.113.1", "/api/uploads", { method: "POST" }), env);
    await guard(from("203.0.113.1", "/tiles/a"), env);
    await guard(from("203.0.113.1", "/assets/a.js"), env);
    await guard(from("203.0.113.1", "/api/uploads/a/status"), env);
    assert.deepEqual(env.LOGIN_LIMIT.keys, ["login:203.0.113.1"]);
    assert.deepEqual(env.UPLOAD_LIMIT.keys, ["upload:203.0.113.1"]);
    assert.deepEqual(env.TILE_LIMIT.keys, ["tile:203.0.113.1"]);
  });

  test("without bindings nothing is limited", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.equal(await guard(from("203.0.113.1", "/api/auth/login"), {}), null);
    }
  });

  test("the Worker answers the flood with 429 and secured headers before routing", async () => {
    const env = { ...limits(2) } as unknown as EdgeEnv;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await edge.fetch(from("203.0.113.1", "/api/auth/login"), env, context);
      statuses.push(response.status);
      if (response.status === 429) {
        assert.equal(response.headers.get("cross-origin-embedder-policy"), "credentialless");
      }
    }
    assert.deepEqual(statuses, [404, 404, 429]);
    const other = await edge.fetch(from("198.51.100.2", "/api/auth/login"), env, context);
    assert.notEqual(other.status, 429);
  });
});

describe("the bot check on login", () => {
  const sent: FormData[] = [];
  const answering =
    (success: boolean, status = 200): Siteverify =>
    (body) => {
      sent.push(body);
      return Promise.resolve(Response.json({ success }, { status }));
    };
  const env: LimitEnv = { TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };

  test("is off when no secret is set", async () => {
    assert.equal(await guard(from("203.0.113.1", "/api/auth/login"), {}, answering(false)), null);
  });

  test("refuses a login without a token or with a failing token", async () => {
    const missing = await guard(from("203.0.113.1", "/api/auth/login"), env, answering(true));
    assert.equal(missing?.status, 403);
    const failing = await guard(
      from("203.0.113.1", "/api/auth/login?turnstile=bad"),
      env,
      answering(false),
    );
    assert.equal(failing?.status, 403);
    const broken = await guard(
      from("203.0.113.1", "/api/auth/login?turnstile=t"),
      env,
      answering(true, 500),
    );
    assert.equal(broken?.status, 403);
    const thrown = await guard(from("203.0.113.1", "/api/auth/login?turnstile=t"), env, () =>
      Promise.reject(new Error("offline")),
    );
    assert.equal(thrown?.status, 403);
  });

  test("lets a login with a passing token through and sends secret, token and address", async () => {
    sent.length = 0;
    const passed = await guard(
      from("203.0.113.1", "/api/auth/login", { headers: { "CF-Turnstile-Response": "good" } }),
      env,
      answering(true),
    );
    assert.equal(passed, null);
    assert.equal(sent[0]?.get("secret"), env.TURNSTILE_SECRET_KEY);
    assert.equal(sent[0]?.get("response"), "good");
    assert.equal(sent[0]?.get("remoteip"), "203.0.113.1");
  });

  test("does not challenge the callback", async () => {
    assert.equal(
      await guard(from("203.0.113.1", "/api/auth/callback"), env, answering(false)),
      null,
    );
  });
});
