import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import edge, { type EdgeEnv } from "../src/index.ts";
import {
  clientAddress,
  guard,
  type LimitEnv,
  limitClassOf,
  normalisePath,
  type Siteverify,
  TEST_ADDRESS_HEADER,
} from "../src/rate-limits.ts";

const ORIGIN = "https://parfocal.test";

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

function limits(login = 3, upload = 3, tile = 3, room = 3, roomInternal = 3) {
  return {
    LOGIN_LIMIT: fakeLimit(login),
    UPLOAD_LIMIT: fakeLimit(upload),
    TILE_LIMIT: fakeLimit(tile),
    ROOM_LIMIT: fakeLimit(room),
    ROOM_INTERNAL_LIMIT: fakeLimit(roomInternal),
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

  test("room joins and internal room calls are counted", async () => {
    const join = "/rt/slide:33333333-3333-4333-8333-333333333333";
    assert.equal(limitClassOf("GET", join), "room");
    assert.equal(limitClassOf("POST", "/rt-internal/publish"), "room-internal");
    assert.equal(limitClassOf("POST", "/rt-internal/revoke"), "room-internal");
    assert.equal(limitClassOf("GET", "/rtx"), null);
    const env = limits();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await guard(from("203.0.113.1", join), env))?.status ?? 200);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
    const publish = { method: "POST" };
    assert.equal(await guard(from("203.0.113.1", "/rt-internal/publish", publish), env), null);
    assert.deepEqual(env.ROOM_LIMIT.keys.at(0), "room:203.0.113.1");
    assert.deepEqual(env.ROOM_INTERNAL_LIMIT.keys, ["room-internal:203.0.113.1"]);
    const config = readFileSync(`${import.meta.dirname}/../wrangler.jsonc`, "utf8");
    assert.match(config, /"name": "ROOM_LIMIT"/);
    assert.match(config, /"name": "ROOM_INTERNAL_LIMIT"/);
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

  test("a missing limit binding answers 503 outside local runs", async () => {
    const { LOGIN_LIMIT: _login, ...withoutLogin } = limits();
    for (const env of [{}, withoutLogin, { LOCAL_RUN: "1" }, { LOCAL_RUN: "false" }]) {
      const response = await guard(from("203.0.113.1", "/api/auth/login"), env);
      assert.ok(response);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Content-Type"), "application/problem+json");
      const body: { readonly code: string } = await response.json();
      assert.equal(body.code, "limit-not-configured");
    }
    assert.equal(await guard(from("203.0.113.1", "/tiles/a"), withoutLogin), null);
    assert.equal(await guard(from("203.0.113.1", "/assets/a.js"), {}), null);
  });

  test("the Worker answers a limited path with 503 and secured headers without its binding", async () => {
    const response = await edge.fetch(from("203.0.113.1", "/tiles/a"), {} as unknown as EdgeEnv);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cross-origin-embedder-policy"), "credentialless");
    const uploads = await edge.fetch(from("203.0.113.1", "/api/uploads", { method: "POST" }), {
      API_ORIGIN: "https://api.parfocal.test",
    } as unknown as EdgeEnv);
    assert.equal(uploads.status, 503);
    const body: { readonly code: string } = await uploads.json();
    assert.equal(body.code, "limit-not-configured");
  });

  test("a local run without bindings limits nothing", async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.equal(
        await guard(from("203.0.113.1", "/api/auth/login"), { LOCAL_RUN: "true" }),
        null,
      );
    }
  });

  test("a trailing slash, an escape, a repeated slash or another case is still counted", async () => {
    const variants = [
      "/api/auth/login/",
      "/api/auth/%6Cogin",
      "/api/auth/%6cogin//",
      "/api//auth/login",
      "/API/Auth/Login",
      "/api/auth/login%2F",
      "/api/auth/callback/?code=1",
    ];
    for (const path of variants) {
      assert.equal(limitClassOf("GET", new URL(path, ORIGIN).pathname), "login", path);
      const env = limits(0);
      const response = await guard(from("203.0.113.1", path), env);
      assert.equal(response?.status, 429, path);
      assert.deepEqual(env.LOGIN_LIMIT.keys, ["login:203.0.113.1"], path);
    }
    assert.equal(limitClassOf("POST", "/api/uploads/"), "upload");
    assert.equal(limitClassOf("PUT", "/api/%75ploads/abc/parts"), "upload");
    assert.equal(limitClassOf("GET", "/tiles/%zz"), "tile");
    assert.equal(limitClassOf("GET", "/%zz"), null);
    assert.equal(limitClassOf("GET", "/api/auth/login%C3%A9"), null);
    assert.equal(normalisePath("/"), "/");
    assert.equal(normalisePath("//"), "/");
  });

  test("the Worker answers the flood with 429 and secured headers before routing", async () => {
    const env = { ...limits(2) } as unknown as EdgeEnv;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await edge.fetch(from("203.0.113.1", "/api/auth/login"), env);
      statuses.push(response.status);
      if (response.status === 429) {
        assert.equal(response.headers.get("cross-origin-embedder-policy"), "credentialless");
      }
    }
    assert.deepEqual(statuses, [503, 503, 429]);
    const other = await edge.fetch(from("198.51.100.2", "/api/auth/login"), env);
    assert.notEqual(other.status, 429);
  });
});

describe("the bot check on a login variant", () => {
  test("a trailing slash or an escape does not skip the check", async () => {
    const env = { ...limits(100), TURNSTILE_SECRET_KEY: "secret" };
    const never: Siteverify = () => Promise.reject(new Error("no token to verify"));
    for (const path of ["/api/auth/login/", "/api/auth/%6Cogin", "/API/auth/login"]) {
      const response = await guard(from("203.0.113.1", path), env, never);
      assert.equal(response?.status, 403, path);
    }
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
  const env: LimitEnv = {
    LOCAL_RUN: "true",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  };

  test("is off when no secret is set", async () => {
    assert.equal(
      await guard(from("203.0.113.1", "/api/auth/login"), { LOCAL_RUN: "true" }, answering(false)),
      null,
    );
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
