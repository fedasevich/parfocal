import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { type LatencyProxy, startLatencyProxy } from "../../../latency-proxy/src/index.ts";
import { startDecodeWorker } from "../../src/decode/worker-runtime.ts";
import { openTiffSource } from "../../src/index.ts";
import {
  createVivLevels,
  createWorkerRegionReader,
  type DecodeWorker,
  type VivLevel,
} from "../../src/viv/index.ts";
import { syntheticDir } from "../pixel-source/fixtures.ts";
import { serve } from "../pixel-source/serve.ts";

const file = "synthetic-jpeg.tiff";
const path = `/synthetic/${file}`;
const frameMs = 16;
const rttMs = 60;
const frameLimit = 40;

const served = await serve({ "/synthetic": syntheticDir });
const proxy: LatencyProxy = await startLatencyProxy({ target: served.origin, rttMs });

after(async () => {
  await proxy.close();
  await served.close();
});

function inProcessWorker(): DecodeWorker {
  const { port1, port2 } = new MessageChannel();
  startDecodeWorker(port2);
  port1.start();
  port2.start();
  return {
    postMessage: (message, transfer) => port1.postMessage(message, transfer),
    addEventListener: (type, listener) =>
      port1.addEventListener(type, listener as unknown as (event: Event) => void),
    terminate: () => port1.close(),
  };
}

interface Outcome {
  readonly frames: number;
  readonly converged: boolean;
  readonly fetches: number;
  readonly bytes: number;
}

async function askEveryFrame(level: VivLevel, tiles: readonly (readonly [number, number])[]) {
  const done = new Set<string>();
  let controllers: AbortController[] = [];
  let frames = 0;
  while (done.size < tiles.length && frames < frameLimit) {
    for (const controller of controllers) controller.abort();
    controllers = [];
    for (const [x, y] of tiles) {
      const key = `${x},${y}`;
      if (done.has(key)) continue;
      const controller = new AbortController();
      controllers.push(controller);
      level.getTile({ x, y, signal: controller.signal }).then(
        () => done.add(key),
        () => undefined,
      );
    }
    frames++;
    await sleep(frameMs);
  }
  for (const controller of controllers) controller.abort();
  return { frames, converged: done.size === tiles.length };
}

function lastRow(level: VivLevel): (readonly [number, number])[] {
  const [height = 0, width = 0] = level.shape;
  const row = Math.ceil(height / level.tileSize) - 1;
  return Array.from(
    { length: Math.ceil(width / level.tileSize) },
    (_, column) => [column, row] as const,
  );
}

describe("a caller that cancels and asks again on every frame, over a source slower than a frame", () => {
  it("never converges when cancelling a tile cancels its download and nothing keeps late chunks (the POC regression)", async () => {
    const source = await openTiffSource({
      formatId: "generic-tiff",
      url: `${proxy.url}${path}`,
      fetch: globalThis.fetch,
    });
    const level = createVivLevels(source).levels[0];
    assert.ok(level);
    proxy.resetStats();
    const { frames, converged } = await askEveryFrame(level, lastRow(level));
    await sleep(rttMs * 2);
    const { requests: fetches, bytes } = proxy.stats();
    const outcome: Outcome = { frames, converged, fetches, bytes };
    console.log(`cancelling downloads: ${JSON.stringify(outcome)}`);
    source.close();
    assert.equal(outcome.converged, false);
    assert.ok(outcome.fetches >= frameLimit / 2, `only ${outcome.fetches} fetches`);
  });

  it("converges with each byte downloaded once when the pool keeps work that has started", async () => {
    const source = await openTiffSource({ formatId: "generic-tiff", url: `${proxy.url}${path}` });
    proxy.resetStats();
    const reader = createWorkerRegionReader({
      request: { formatId: "generic-tiff", url: `${proxy.url}${path}` },
      spawn: inProcessWorker,
    });
    try {
      const level = createVivLevels(source, { read: reader.read }).levels[0];
      assert.ok(level);
      const tiles = lastRow(level);
      const { frames, converged } = await askEveryFrame(level, tiles);
      const { requests: fetches, bytes } = proxy.stats();
      const outcome: Outcome = { frames, converged, fetches, bytes };
      console.log(`keeping started work: ${JSON.stringify(outcome)}`);
      assert.equal(outcome.converged, true);
      assert.equal(outcome.fetches, reader.stats().network.fetches);
      assert.equal(outcome.fetches, 1);
      const stats = reader.stats();
      assert.equal(stats.dispatched, tiles.length);
      assert.ok(stats.orphanedInFlight > 0);
      assert.ok(stats.joined > 0);
    } finally {
      reader.dispose();
      source.close();
    }
  });
});
