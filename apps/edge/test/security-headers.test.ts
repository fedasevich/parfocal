import assert from "node:assert/strict";
import { test } from "node:test";
import worker, { type EdgeEnv } from "../src/index.ts";
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

const context = { waitUntil: () => undefined } as unknown as ExecutionContext;

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://parfocal.example${path}`), env, context);
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
