import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { latencyToleranceMs, measureAddedLatency } from "#measure.ts";
import { type OriginServer, startOriginServer } from "#origin.ts";
import {
  CONTROL_PATH,
  type LatencyProxy,
  RTT_MATRIX_MS,
  startLatencyProxy,
  transferMs,
  validateConditions,
} from "#proxy.ts";

let origin: OriginServer;
let proxy: LatencyProxy;

before(async () => {
  origin = await startOriginServer({ "/hello": { body: "hello", contentType: "text/plain" } });
  proxy = await startLatencyProxy({ target: origin.url });
});

after(async () => {
  await proxy.close();
  await origin.close();
});

async function fastestOf(attempts: number, run: () => Promise<number>): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts; attempt++) {
    best = Math.min(best, await run());
  }
  return best;
}

function assertNear(measured: number, expected: number, what: string): void {
  const message = `${what} took ${measured.toFixed(1)} ms at best, expected ${expected} ms`;
  assert.ok(measured >= expected - 1, message);
  assert.ok(measured <= expected + latencyToleranceMs(expected), message);
}

async function timed(url: string): Promise<{ ms: number; bytes: number }> {
  const started = performance.now();
  const response = await fetch(url);
  const body = await response.arrayBuffer();
  return { ms: performance.now() - started, bytes: body.byteLength };
}

describe("added round-trip time", () => {
  for (const rttMs of RTT_MATRIX_MS) {
    test(`${rttMs} ms RTT adds ${rttMs} ms per request within tolerance`, async () => {
      proxy.setConditions({ rttMs, bandwidthBytesPerSecond: null });
      const sample = await measureAddedLatency(
        `${origin.url}/bytes/1024`,
        `${proxy.url}/bytes/1024`,
        5,
      );
      const tolerance = latencyToleranceMs(rttMs);
      const best = sample.proxiedMinMs - sample.directMinMs;
      const summary = `fastest proxied ${sample.proxiedMinMs.toFixed(2)} ms against fastest direct ${sample.directMinMs.toFixed(2)} ms, median added ${sample.addedMs.toFixed(2)} ms, at ${rttMs} ms RTT with tolerance ${tolerance} ms`;
      assert.ok(sample.proxiedMinMs >= rttMs, summary);
      assert.ok(best <= rttMs + tolerance, summary);
    });
  }
});

test("the bandwidth limit stretches a transfer to its size divided by the rate", async () => {
  const bytes = 400_000;
  const bandwidthBytesPerSecond = 1_000_000;
  proxy.setConditions({ rttMs: 0, bandwidthBytesPerSecond });
  const fastest = await fastestOf(3, async () => {
    const result = await timed(`${proxy.url}/bytes/${bytes}`);
    assert.equal(result.bytes, bytes);
    return result.ms;
  });
  assertNear(fastest, transferMs(bytes, bandwidthBytesPerSecond), "one transfer");
});

test("concurrent responses share one link", async () => {
  const bytes = 200_000;
  const bandwidthBytesPerSecond = 1_000_000;
  proxy.setConditions({ rttMs: 0, bandwidthBytesPerSecond });
  const fastest = await fastestOf(3, async () => {
    const started = performance.now();
    await Promise.all([timed(`${proxy.url}/bytes/${bytes}`), timed(`${proxy.url}/bytes/${bytes}`)]);
    return performance.now() - started;
  });
  assertNear(fastest, transferMs(bytes * 2, bandwidthBytesPerSecond), "two parallel transfers");
});

async function timedUpload(url: string, bytes: number): Promise<{ ms: number; received: number }> {
  const started = performance.now();
  const response = await fetch(url, { method: "PUT", body: new Uint8Array(bytes) });
  const { received } = (await response.json()) as { received: number };
  return { ms: performance.now() - started, received };
}

test("the uplink limit stretches an upload to its size divided by the rate", async () => {
  const bytes = 400_000;
  const uplinkBytesPerSecond = 1_000_000;
  proxy.setConditions({ rttMs: 0, bandwidthBytesPerSecond: null, uplinkBytesPerSecond });
  proxy.resetStats();
  const fastest = await fastestOf(3, async () => {
    const result = await timedUpload(`${proxy.url}/sink`, bytes);
    assert.equal(result.received, bytes);
    return result.ms;
  });
  assertNear(fastest, transferMs(bytes, uplinkBytesPerSecond), "one upload");
  assert.equal(proxy.stats().uploadedBytes, bytes * 3);
  proxy.setConditions({ uplinkBytesPerSecond: null });
});

test("concurrent uploads share one uplink and leave the downlink free", async () => {
  const bytes = 200_000;
  const uplinkBytesPerSecond = 1_000_000;
  proxy.setConditions({ rttMs: 0, bandwidthBytesPerSecond: null, uplinkBytesPerSecond });
  const fastest = await fastestOf(3, async () => {
    const started = performance.now();
    await Promise.all([
      timedUpload(`${proxy.url}/sink`, bytes),
      timedUpload(`${proxy.url}/sink`, bytes),
    ]);
    return performance.now() - started;
  });
  assertNear(fastest, transferMs(bytes * 2, uplinkBytesPerSecond), "two parallel uploads");
  const download = await fastestOf(3, async () => (await timed(`${proxy.url}/bytes/400000`)).ms);
  assert.ok(download < 50, `a download under an uplink limit took ${download.toFixed(1)} ms`);
  proxy.setConditions({ uplinkBytesPerSecond: null });
});

test("RTT and bandwidth add up", async () => {
  proxy.setConditions({ rttMs: 100, bandwidthBytesPerSecond: 2_000_000 });
  const fastest = await fastestOf(3, async () => (await timed(`${proxy.url}/bytes/200000`)).ms);
  assertNear(fastest, 100 + transferMs(200_000, 2_000_000), "a throttled request");
});

test("the control endpoint changes conditions and resets counters", async () => {
  proxy.setConditions({ rttMs: 0, bandwidthBytesPerSecond: null });
  proxy.resetStats();
  assert.equal(await (await fetch(`${proxy.url}/hello`)).text(), "hello");
  assert.deepEqual(proxy.stats(), { requests: 1, bytes: 5, uploadedBytes: 0 });
  const state: unknown = await (
    await fetch(`${proxy.url}${CONTROL_PATH}?rtt=50&bandwidth=1000000&uplink=500000`)
  ).json();
  assert.deepEqual(state, {
    rttMs: 50,
    bandwidthBytesPerSecond: 1_000_000,
    uplinkBytesPerSecond: 500_000,
    requests: 1,
    bytes: 5,
    uploadedBytes: 0,
  });
  await fetch(`${proxy.url}${CONTROL_PATH}?reset&bandwidth=unlimited&uplink=unlimited`);
  assert.deepEqual(proxy.stats(), { requests: 0, bytes: 0, uploadedBytes: 0 });
  assert.deepEqual(proxy.conditions(), {
    rttMs: 50,
    bandwidthBytesPerSecond: null,
    uplinkBytesPerSecond: null,
  });
  assert.equal((await fetch(`${proxy.url}${CONTROL_PATH}?rtt=-1`)).status, 400);
});

test("status codes and headers pass through", async () => {
  proxy.setConditions({ rttMs: 0, bandwidthBytesPerSecond: null });
  const missing = await fetch(`${proxy.url}/nope`);
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  const found = await fetch(`${proxy.url}/bytes/10`);
  assert.equal(found.headers.get("content-length"), "10");
  await found.arrayBuffer();
});

test("invalid conditions are rejected", () => {
  const open = { rttMs: 0, bandwidthBytesPerSecond: null, uplinkBytesPerSecond: null };
  assert.throws(() => validateConditions({ ...open, rttMs: -5 }), RangeError);
  assert.throws(() => validateConditions({ ...open, bandwidthBytesPerSecond: 0 }), RangeError);
  assert.throws(() => validateConditions({ ...open, uplinkBytesPerSecond: -1 }), RangeError);
  assert.throws(() => proxy.setConditions({ rttMs: Number.NaN }), RangeError);
});

test("an unreachable target answers 502", async () => {
  const closed = await startOriginServer();
  const target = closed.url;
  await closed.close();
  const orphan = await startLatencyProxy({ target });
  try {
    const response = await fetch(`${orphan.url}/hello`);
    assert.equal(response.status, 502);
    await response.text();
  } finally {
    await orphan.close();
  }
});
