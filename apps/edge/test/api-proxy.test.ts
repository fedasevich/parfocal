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
  const body = await response.json<{ code: string }>();
  assert.equal(body.code, "api-not-configured");
});

test("the Worker sends its Modal proxy token and drops one a client tried to send", async () => {
  const { send, sent } = recorder(new Response("ok"));
  const request = new Request("https://app.parfocal.test/api/health", {
    headers: { "Modal-Key": "client-key", "Modal-Secret": "client-secret" },
  });
  const env = { API_ORIGIN, MODAL_PROXY_TOKEN_ID: "wk-1", MODAL_PROXY_TOKEN_SECRET: "ws-1" };
  await handleApi(request, env, send);
  const headers = new Headers(sent[0]?.init.headers);
  assert.equal(headers.get("Modal-Key"), "wk-1");
  assert.equal(headers.get("Modal-Secret"), "ws-1");
});

test("without a proxy token no client copy of one reaches the API", async () => {
  const { send, sent } = recorder(new Response("ok"));
  const request = new Request("https://app.parfocal.test/api/health", {
    headers: { "Modal-Key": "client-key", "Modal-Secret": "client-secret" },
  });
  await handleApi(request, { API_ORIGIN }, send);
  const headers = new Headers(sent[0]?.init.headers);
  assert.equal(headers.get("Modal-Key"), null);
  assert.equal(headers.get("Modal-Secret"), null);
});

test("the Worker never lets Cloudflare cache an API answer", async () => {
  const { send, sent } = recorder(
    new Response("id,class\nT1,tumour", { headers: { "Content-Type": "text/csv" } }),
  );
  const request = new Request(
    "https://app.parfocal.test/api/review-tasks/t1/evaluation/exports/objects.csv",
  );
  const response = await handleApi(request, { API_ORIGIN }, send);
  assert.equal(sent[0]?.init.cache, "no-store");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await response.text(), "id,class\nT1,tumour");
});

test("an API answer that sets its own caching keeps it", async () => {
  const reply = new Response("tile", { headers: { "Cache-Control": "private, max-age=3600" } });
  const { send } = recorder(reply);
  const response = await handleApi(
    new Request("https://app.parfocal.test/api/x"),
    { API_ORIGIN },
    send,
  );
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=3600");
});
