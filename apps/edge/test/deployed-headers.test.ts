import assert from "node:assert/strict";
import { test } from "node:test";
import { headerProblems, nonceOf } from "../src/security-headers.ts";

type NodeGlobal = { readonly process: { readonly env: Record<string, string | undefined> } };

const base = (globalThis as unknown as NodeGlobal).process.env["PARFOCAL_HEADERS_URL"];

test("a deployed environment serves the security headers", {
  skip: !base && "PARFOCAL_HEADERS_URL is not set",
}, async () => {
  const root = new URL("/", base);
  const navigate = { headers: { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } };
  const first = await fetch(root, navigate);
  const second = await fetch(root, navigate);
  assert.deepEqual(headerProblems(first.headers, "document"), []);
  const nonce = nonceOf(first.headers);
  assert.ok(nonce);
  assert.notEqual(nonce, nonceOf(second.headers));
  const html = await first.text();
  assert.ok(html.includes(`nonce="${nonce}"`));
  const entry = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(entry, "the document loads a module script");
  const script = await fetch(new URL(entry, root));
  assert.deepEqual(headerProblems(script.headers, "resource"), []);
  const deep = await fetch(new URL("/projects/missing/review", root), navigate);
  assert.match(deep.headers.get("content-type") ?? "", /^text\/html/);
  assert.deepEqual(headerProblems(deep.headers, "document"), []);
  assert.ok((await deep.text()).includes(`nonce="${nonceOf(deep.headers)}"`));
  for (const path of ["/tiles/missing", "/assets/missing.js"]) {
    const response = await fetch(new URL(path, root));
    assert.equal(response.headers.get("cross-origin-embedder-policy"), "credentialless", path);
  }
});
