import assert from "node:assert/strict";
import { test } from "node:test";

type NodeGlobal = { readonly process: { readonly env: Record<string, string | undefined> } };

const settings = (globalThis as unknown as NodeGlobal).process.env;
const edge = settings["PARFOCAL_EDGE_URL"];
const origin = settings["PARFOCAL_API_ORIGIN_URL"];
const missing = (!edge || !origin) && "PARFOCAL_EDGE_URL or PARFOCAL_API_ORIGIN_URL is not set";

async function statusOf(url: URL, headers: Record<string, string> = {}): Promise<number> {
  const response = await fetch(url, { redirect: "manual", headers });
  await response.arrayBuffer();
  return response.status;
}

function isRefusal(status: number): boolean {
  return status >= 400 && status < 500;
}

test("the API answers through the Worker", { skip: missing }, async () => {
  assert.equal(await statusOf(new URL("/api/health", edge)), 200);
});

test("the API address refuses a request that skipped the Worker", { skip: missing }, async () => {
  for (const path of ["/api/health", "/api/auth/login?return_to=/"]) {
    const status = await statusOf(new URL(path, origin));
    assert.ok(isRefusal(status), `${path} answered ${status} at the API address`);
  }
});

test("the API address refuses a forged proxy token", { skip: missing }, async () => {
  const forged = { "Modal-Key": "wk-forged", "Modal-Secret": "ws-forged" };
  const status = await statusOf(new URL("/api/health", origin), forged);
  assert.ok(isRefusal(status), `a forged token got ${status} at the API address`);
});
