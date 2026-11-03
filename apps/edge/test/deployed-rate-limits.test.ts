import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { test } from "node:test";
import { TEST_ADDRESS_HEADER } from "../src/rate-limits.ts";

type NodeGlobal = { readonly process: { readonly env: Record<string, string | undefined> } };

const base = (globalThis as unknown as NodeGlobal).process.env["PARFOCAL_RATE_LIMIT_URL"];
const FLOOD_ATTEMPTS = 60;

type Client = { readonly address: string; readonly family?: 4 | 6 };

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function signIn(url: URL, client: Client): Promise<number> {
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = send(
      url.href,
      {
        method: "GET",
        headers: { [TEST_ADDRESS_HEADER]: client.address },
        ...(client.family ? { family: client.family } : {}),
      },
      (incoming) => {
        incoming.resume();
        incoming.on("end", () => resolve(incoming.statusCode ?? 0));
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

test("a login flood from one address gets 429 while another address signs in", {
  skip: !base && "PARFOCAL_RATE_LIMIT_URL is not set",
}, async () => {
  const login = new URL("/api/auth/login?return_to=/", base);
  const local = isLoopback(login.hostname);
  const run = Date.now() % 250;
  const flooder: Client = local
    ? { address: `198.51.100.${run}` }
    : { address: "flooder", family: 4 };
  const other: Client = local ? { address: `203.0.113.${run}` } : { address: "other", family: 6 };
  const statuses: number[] = [];
  for (let attempt = 0; attempt < FLOOD_ATTEMPTS; attempt += 1) {
    const status = await signIn(login, flooder);
    statuses.push(status);
    if (status === 429) break;
  }
  assert.equal(statuses.at(-1), 429, `no 429 in ${statuses.length} attempts`);
  assert.ok(statuses.length > 1, "the first login was already refused");
  const status = await signIn(login, other);
  assert.notEqual(status, 429, "the other address was limited too");
  assert.ok(status < 500, `the other address got ${status}`);
});
