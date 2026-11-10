import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { syntheticDir } from "@parfocal/test-fixtures";
import type { DecodeReply, DecodeRequest } from "../../src/decode/protocol.ts";
import { startDecodeWorker } from "../../src/decode/worker-runtime.ts";
import { readTileIndex } from "../../src/index.ts";
import type { PatchReply } from "../../src/patch/protocol.ts";
import { createWorkerPatchReader, PatchWorkerError } from "../../src/patch/worker-client.ts";
import type { PixelSource } from "../../src/pixel-source/index.ts";
import {
  createVivLevels,
  createWorkerRegionReader,
  type DecodeWorker,
  DecodeWorkerError,
  disposingOnThrow,
  UnsupportedVivSourceError,
  type VivRegion,
} from "../../src/viv/index.ts";
import { serve } from "../pixel-source/serve.ts";

const request = { formatId: "generic-tiff", url: "https://slides.example/slide.tiff" } as const;
const region: VivRegion = {
  backing: 0,
  residual: 1,
  window: [0, 0, 64, 32],
  width: 64,
  height: 32,
};
const centre = { x: 0, y: 0 };
const query = { level: 0, size: 64, x: 0, y: 0 };
const info = { levels: [], micronsPerPixel: null, photometric: "rgb", dtype: "uint8" } as const;

function scriptedWorker<Reply>() {
  const listeners = new Map<string, ((event: Event) => void)[]>();
  const posted: unknown[] = [];
  let terminated = false;
  const emit = (type: string, event: Event) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return {
    worker: {
      postMessage: (message: unknown) => {
        posted.push(message);
      },
      addEventListener: (type: string, listener: (event: never) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener as (event: Event) => void]);
      },
      terminate: () => {
        terminated = true;
      },
    },
    posted,
    terminated: () => terminated,
    reply: (data: Reply) => emit("message", new MessageEvent("message", { data })),
    fail: (type: "error" | "messageerror") => emit(type, new Event(type)),
  };
}

async function settled(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise.then(
      () => "resolved",
      (error: unknown) => error,
    ),
    new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
  ]);
}

function decodeReader(onFailure: (error: Error) => void) {
  const workers = [scriptedWorker<DecodeReply>(), scriptedWorker<DecodeReply>()];
  const reader = createWorkerRegionReader({
    request,
    size: workers.length,
    spawn: (index) => workers[index]?.worker as DecodeWorker,
    onFailure,
  });
  return { workers, reader };
}

describe("a decode worker that fails", () => {
  for (const type of ["error", "messageerror"] as const) {
    it(`rejects ready and every read when a worker fires ${type} before it opened`, async () => {
      const failures: Error[] = [];
      const { workers, reader } = decodeReader((error) => failures.push(error));
      try {
        const read = reader.read(region, centre);
        workers[1]?.fail(type);
        assert.ok((await settled(reader.ready)) instanceof DecodeWorkerError);
        assert.ok((await settled(read)) instanceof DecodeWorkerError);
        const later = reader.read({ ...region, backing: 1 }, centre);
        assert.ok((await settled(later)) instanceof DecodeWorkerError);
        assert.equal(reader.idle(), true);
        assert.equal(failures.length, 1);
      } finally {
        reader.dispose();
      }
    });
  }

  it("rejects the reads in flight when a worker stops after it opened", async () => {
    const failures: Error[] = [];
    const { workers, reader } = decodeReader((error) => failures.push(error));
    try {
      for (const worker of workers) worker.reply({ type: "opened", report: null });
      await reader.ready;
      const reads = [reader.read(region, centre), reader.read({ ...region, backing: 1 }, centre)];
      workers[0]?.fail("error");
      for (const read of reads) assert.ok((await settled(read)) instanceof DecodeWorkerError);
      assert.equal(reader.idle(), true);
      assert.equal(failures.length, 1);
    } finally {
      reader.dispose();
    }
  });
});

describe("a slide the route cannot draw", () => {
  const deepRgb: PixelSource = {
    formatId: "ome-tiff",
    levels: [{ downsample: 1, width: 512, height: 512, tileWidth: 256, tileHeight: 256 }],
    tileSize: { width: 256, height: 256 },
    micronsPerPixel: null,
    photometric: "rgb",
    dtype: "uint16",
    channels: ["Red", "Green", "Blue"].map((name) => ({ name, color: null, window: null })),
    getTile: () => Promise.resolve({ absent: true, width: 256, height: 256 }),
    getRaster: () => Promise.resolve({ absent: true, width: 1, height: 1 }),
    close: () => undefined,
  };

  it("leaves no decode worker behind when building its levels throws", () => {
    const workers = Array.from({ length: 6 }, () => scriptedWorker<DecodeReply>());
    const reader = createWorkerRegionReader({
      request,
      size: workers.length,
      spawn: (index) => workers[index]?.worker as DecodeWorker,
    });
    assert.throws(
      () => disposingOnThrow(reader, () => createVivLevels(deepRgb, { read: reader.read })),
      UnsupportedVivSourceError,
    );
    assert.deepEqual(
      workers.map((worker) => worker.terminated()),
      workers.map(() => true),
    );
  });

  it("keeps the workers of a slide whose levels build", () => {
    const workers = [scriptedWorker<DecodeReply>()];
    const reader = createWorkerRegionReader({
      request,
      size: 1,
      spawn: (index) => workers[index]?.worker as DecodeWorker,
    });
    try {
      assert.equal(
        disposingOnThrow(reader, () => "built"),
        "built",
      );
      assert.equal(workers[0]?.terminated(), false);
    } finally {
      reader.dispose();
    }
  });
});

describe("a patch worker that fails", () => {
  for (const type of ["error", "messageerror"] as const) {
    it(`rejects ready and every read when the worker fires ${type} before it opened`, async () => {
      const scripted = scriptedWorker<PatchReply>();
      const reader = createWorkerPatchReader({
        request,
        spawn: () => scripted.worker,
      });
      try {
        const read = reader.read(query);
        scripted.fail(type);
        assert.ok((await settled(reader.ready)) instanceof PatchWorkerError);
        assert.ok((await settled(read)) instanceof PatchWorkerError);
      } finally {
        reader.close();
      }
    });
  }

  it("rejects the reads in flight and later ones when the worker stops after it opened", async () => {
    const scripted = scriptedWorker<PatchReply>();
    const reader = createWorkerPatchReader({
      request,
      spawn: () => scripted.worker,
    });
    try {
      scripted.reply({ type: "opened", info });
      await reader.ready;
      const read = reader.read(query);
      await new Promise((resolve) => setTimeout(resolve, 0));
      scripted.fail("error");
      assert.ok((await settled(read)) instanceof PatchWorkerError);
      assert.ok((await settled(reader.read(query))) instanceof PatchWorkerError);
    } finally {
      reader.close();
    }
  });
});

describe("a decode worker with fewer levels than the page", () => {
  const goldenIndex = new URL(
    "../../../../workers/ingest/tests/golden/tile-index/synthetic-jpeg.tiff.json",
    import.meta.url,
  );

  function inProcessWorker(): DecodeWorker {
    const { port1, port2 } = new MessageChannel();
    startDecodeWorker(port2);
    port1.start();
    port2.start();
    return {
      postMessage: (message: DecodeRequest, transfer: Transferable[]) =>
        port1.postMessage(message, transfer),
      addEventListener: (type: string, listener: (event: never) => void) =>
        port1.addEventListener(type, listener as (event: Event) => void),
      terminate: () => port1.close(),
    };
  }

  it("fails its open when the overview levels the page has could not be opened", async () => {
    const served = await serve({ "/synthetic": syntheticDir });
    const index = readTileIndex({
      ...JSON.parse(await readFile(goldenIndex, "utf8")),
      overviewLevels: { path: "missing-overview-levels.tiff", downsamples: [8] },
    });
    const readerWith = (levels: number) =>
      createWorkerRegionReader({
        request: {
          formatId: "generic-tiff",
          url: served.url("/synthetic/synthetic-jpeg.tiff"),
          index,
          levels,
        },
        size: 1,
        spawn: inProcessWorker,
      });
    const alone = readerWith(3);
    const short = readerWith(4);
    try {
      await alone.ready;
      await assert.rejects(short.ready, (error: unknown) => {
        assert.ok(error instanceof DecodeWorkerError);
        assert.match(error.message, /3 levels where the page has 4/);
        return true;
      });
    } finally {
      alone.dispose();
      short.dispose();
      await served.close();
    }
  });
});
