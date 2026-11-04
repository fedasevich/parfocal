import assert from "node:assert/strict";
import { test } from "node:test";
import { createPolygonBatch, createPolygonBatchInWorker } from "../../src/index.ts";
import {
  startTriangulationWorker,
  type TriangulationReply,
  type TriangulationWorker,
} from "../../src/overlay/triangulation-worker.ts";

function loopbackWorker(): { worker: TriangulationWorker; terminated: () => boolean } {
  let handler: ((event: MessageEvent<never>) => void) | null = null;
  let done = false;
  const scope = {
    addEventListener(_type: "message", listener: (event: MessageEvent<never>) => void) {
      handler = listener;
    },
    postMessage(message: TriangulationReply) {
      queueMicrotask(() => replyTo?.({ data: message } as MessageEvent<TriangulationReply>));
    },
  };
  let replyTo: ((event: MessageEvent<TriangulationReply>) => void) | null = null;
  startTriangulationWorker(scope);
  const worker: TriangulationWorker = {
    postMessage(message) {
      queueMicrotask(() => handler?.({ data: message } as never));
    },
    addEventListener(type: string, listener: unknown) {
      if (type === "message") replyTo = listener as typeof replyTo;
    },
    terminate() {
      done = true;
    },
  };
  return { worker, terminated: () => done };
}

function squares(count: number) {
  const positions = new Float32Array(count * 8);
  const starts = new Uint32Array(count + 1);
  const colors = new Uint8Array(count * 4).fill(200);
  for (let polygon = 0; polygon < count; polygon++) {
    positions.set(
      [0, 0, 10, 0, 10, 10, 0, 10].map((value) => value + polygon * 20),
      polygon * 8,
    );
    starts[polygon + 1] = (polygon + 1) * 4;
  }
  return { positions, starts, colors };
}

test("a batch made in the worker equals the batch made in place", async () => {
  const expected = createPolygonBatch(squares(50));
  const { worker, terminated } = loopbackWorker();
  const batch = await createPolygonBatchInWorker(squares(50), { spawn: () => worker });
  assert.deepEqual(batch.indices, expected.indices);
  assert.deepEqual(batch.positions, expected.positions);
  assert.deepEqual(batch.starts, expected.starts);
  assert.equal(batch.count, expected.count);
  assert.equal(terminated(), true);
});

test("a bad batch rejects with the validation message", async () => {
  const flat = squares(2);
  const { worker } = loopbackWorker();
  await assert.rejects(
    createPolygonBatchInWorker(
      { ...flat, starts: Uint32Array.from([0, 4, 7]) },
      { spawn: () => worker },
    ),
    /Batch starts must begin at 0 and end at the vertex count/,
  );
});
