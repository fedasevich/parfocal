import assert from "node:assert/strict";
import { test } from "node:test";
import { signingKey, WeakSigningKeyError } from "../src/capability.ts";
import worker, { type EdgeEnv } from "../src/index.ts";
import { ROOM_PROTOCOL } from "../src/room-client.ts";
import {
  contentSecurityPolicy,
  headerProblems,
  NONCE_PLACEHOLDER,
  nonceOf,
  uploadOriginOf,
} from "../src/security-headers.ts";

const SECRET = btoa("k".repeat(32));
const UPLOAD_ORIGIN = "https://0123456789abcdef.r2.cloudflarestorage.com";

const builtIndex = `<!doctype html><html><head>
<meta property="csp-nonce" nonce="${NONCE_PLACEHOLDER}">
<script type="module" crossorigin src="/assets/index-abc.js" nonce="${NONCE_PLACEHOLDER}"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-def.js" nonce="${NONCE_PLACEHOLDER}">
</head><body><div id="root"></div></body></html>`;

const assets = {
  fetch(request: Request) {
    const { pathname } = new URL(request.url);
    if (pathname.endsWith(".js")) {
      return Promise.resolve(
        new Response("export {}", { headers: { "Content-Type": "text/javascript", ETag: '"js"' } }),
      );
    }
    if (pathname.endsWith(".wasm")) {
      return Promise.resolve(
        new Response(new Uint8Array([0, 97, 115, 109]), {
          headers: { "Content-Type": "application/wasm" },
        }),
      );
    }
    return Promise.resolve(
      new Response(builtIndex, {
        headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"html"' },
      }),
    );
  },
} as unknown as Fetcher;

const env = {
  SLIDES: {
    get: () => Promise.resolve(null),
    head: () => Promise.resolve(null),
  } as unknown as R2Bucket,
  TILE_TOKEN_KEY: SECRET,
  ROOMS: {} as DurableObjectNamespace,
  ROOM_TOKEN_KEY: SECRET,
  ASSETS: assets,
  UPLOAD_ORIGIN: `${UPLOAD_ORIGIN}/`,
} satisfies EdgeEnv;

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://parfocal.example${path}`), env);
}

test("a document gets a fresh nonce in both the CSP and every nonce attribute", async () => {
  const first = await get("/projects/abc/review");
  const second = await get("/");
  const nonce = nonceOf(first.headers);
  assert.ok(nonce);
  assert.notEqual(nonce, nonceOf(second.headers));
  const html = await first.text();
  assert.equal(html.includes(NONCE_PLACEHOLDER), false);
  assert.equal(html.split(`nonce="${nonce}"`).length - 1, 3);
  assert.deepEqual(headerProblems(first.headers, "document"), []);
  assert.equal(first.headers.get("ETag"), null);
});

test("the document CSP allows exactly the app origin and the upload origin to be fetched", async () => {
  const csp = (await get("/")).headers.get("Content-Security-Policy") ?? "";
  assert.match(csp, new RegExp(`connect-src 'self' ${UPLOAD_ORIGIN.replaceAll(".", "\\.")}(;|$)`));
  assert.match(csp, /script-src 'nonce-[^']+' 'strict-dynamic' 'wasm-unsafe-eval';/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.doesNotMatch(csp, /(^|\s)'unsafe-eval'|https:(;|\s)|\*/);
});

test("module workers and WASM files keep cross-origin isolation and carry no CSP of their own", async () => {
  for (const path of ["/assets/decode.worker-xyz.js", "/assets/ort-wasm-simd-threaded.jsep.wasm"]) {
    const response = await get(path);
    assert.deepEqual(headerProblems(response.headers, "resource"), [], path);
    assert.equal(response.headers.get("Content-Security-Policy"), null, path);
    assert.equal(
      response.headers.get("Strict-Transport-Security"),
      "max-age=31536000; includeSubDomains",
    );
  }
  assert.equal((await get("/assets/a.js")).headers.get("ETag"), '"js"');
});

test("tile gateway errors carry the same isolation headers", async () => {
  const response = await get("/tiles/x/y");
  assert.deepEqual(headerProblems(response.headers, "resource"), []);
});

test("a malformed tile token gets 401 with the same isolation headers", async () => {
  const response = await worker.fetch(
    new Request("https://parfocal.example/tiles/x/original.svs", {
      headers: { Authorization: "Bearer a.b" },
    }),
    env,
  );
  assert.equal(response.status, 401);
  assert.deepEqual(headerProblems(response.headers, "resource"), []);
});

test("without an upload origin the CSP connects to the app origin only", () => {
  assert.match(contentSecurityPolicy({ nonce: "n" }), /connect-src 'self';/);
  assert.equal(uploadOriginOf(undefined), undefined);
  assert.throws(() => uploadOriginOf("http://r2.example"), /https/);
});

test("the header check reports a missing COEP and a cacheable document", () => {
  const problems = headerProblems(new Headers({ "Cache-Control": "max-age=60" }), "document");
  assert.ok(problems.some((line) => line.startsWith("cross-origin-embedder-policy is missing")));
  assert.ok(problems.includes("document is cacheable"));
});

test("a wrong upload origin breaks documents only, never tile bytes", async () => {
  const broken = { ...env, UPLOAD_ORIGIN: "http://r2.example" };
  const tiles = await worker.fetch(new Request("https://parfocal.example/tiles/x/y"), broken);
  assert.equal(tiles.headers.get("Cross-Origin-Embedder-Policy"), "credentialless");
  await assert.rejects(worker.fetch(new Request("https://parfocal.example/"), broken), /https/);
});

test("a room path that cannot be decoded is a 404 problem with the isolation headers", async () => {
  const response = await get("/rt/%zz");
  assert.equal(response.status, 404);
  assert.equal((await response.json<{ code: string }>()).code, "room-not-found");
  assert.deepEqual(headerProblems(response.headers, "resource"), []);
});

test("a handler that throws or rejects is a 500 problem with the isolation headers", async () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => {
    logged.push(parts);
  };
  try {
    for (const fetch of [
      () => {
        throw new Error("the assets binding is missing");
      },
      () => Promise.reject(new Error("the assets binding failed")),
    ]) {
      const response = await worker.fetch(new Request("https://parfocal.example/"), {
        ...env,
        ASSETS: { fetch } as unknown as Fetcher,
      });
      assert.equal(response.status, 500);
      assert.equal((await response.json<{ code: string }>()).code, "internal-error");
      assert.deepEqual(headerProblems(response.headers, "resource"), []);
    }
    assert.equal(logged.length, 2);
  } finally {
    console.error = original;
  }
});

test("a signing key under 32 bytes is refused", async () => {
  for (const secret of ["", "change-me", btoa("k".repeat(31))]) {
    await assert.rejects(signingKey(secret), WeakSigningKeyError);
  }
  assert.equal((await signingKey(btoa("k".repeat(32)))).type, "secret");
});

test("a Worker with a short key answers 503 for tiles and rooms, with the isolation headers", async () => {
  const weak = { ...env, TILE_TOKEN_KEY: btoa("short"), ROOM_TOKEN_KEY: "" };
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => {
    logged.push(parts);
  };
  try {
    for (const request of [
      new Request("https://parfocal.example/tiles/x/original.svs", {
        headers: { Authorization: "Bearer a.b" },
      }),
      new Request(`https://parfocal.example/rt/slide:${crypto.randomUUID()}`, {
        headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${ROOM_PROTOCOL}, a.b` },
      }),
    ]) {
      const response = await worker.fetch(request, weak);
      assert.equal(response.status, 503);
      assert.equal((await response.json<{ code: string }>()).code, "signing-key-not-configured");
      assert.deepEqual(headerProblems(response.headers, "resource"), []);
    }
    assert.equal(logged.length, 2);
  } finally {
    console.error = original;
  }
});
