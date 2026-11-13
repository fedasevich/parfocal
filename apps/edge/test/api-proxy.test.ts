import assert from "node:assert/strict";
import { test } from "node:test";
import { handleApi, isApiPath, type Send } from "../src/api-proxy.ts";
import worker, { type EdgeEnv } from "../src/index.ts";

const API_ORIGIN = "https://example--parfocal-api-web.modal.run";

type Sent = { url: string; init: RequestInit };

function recorder(reply: Response): { send: Send; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    send: (url, init) => {
      sent.push({ url, init });
      return Promise.resolve(reply);
    },
  };
}

test("only /api and what lies under it is an API path", () => {
  assert.equal(isApiPath("/api"), true);
  assert.equal(isApiPath("/api/health"), true);
  assert.equal(isApiPath("/apiary"), false);
  assert.equal(isApiPath("/tiles/api/x"), false);
});

test("an API request goes to the API origin with its path, query, method and headers", async () => {
  const { send, sent } = recorder(new Response("ok"));
  const request = new Request("https://app.parfocal.test/api/cases?page=2", {
    method: "POST",
    headers: { Origin: "https://app.parfocal.test", Cookie: "session=1" },
    body: "{}",
  });
  const response = await handleApi(request, { API_ORIGIN }, send);
  assert.equal(await response.text(), "ok");
  const [call] = sent;
  assert.ok(call);
  assert.equal(call.url, `${API_ORIGIN}/api/cases?page=2`);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "manual");
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("Origin"), "https://app.parfocal.test");
  assert.equal(headers.get("Cookie"), "session=1");
  assert.equal(headers.get("X-Forwarded-Host"), "app.parfocal.test");
});

test("without an API origin the Worker answers a 503 problem instead of the app page", async () => {
  const assets = { fetch: () => Promise.resolve(new Response("<html>")) } as unknown as Fetcher;
  const env = { ASSETS: assets } as unknown as EdgeEnv;
  const response = await worker.fetch(new Request("https://app.parfocal.test/api/health"), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Content-Type"), "application/problem+json");
  const body = (await response.json()) as { code: string };
  assert.equal(body.code, "api-not-configured");
});
