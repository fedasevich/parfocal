import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInferenceEngine,
  createSamClient,
  type SamGraph,
  type SamReply,
  type SamRequest,
  type SamWorker,
  SamWorkerError,
  samGraphs,
  startSamWorker,
} from "../../src/index.ts";
import { FakeModelCache, FakeRuntime, tick } from "./sam-fakes.ts";

type Listener = (event: { data: never }) => void;

function linkedWorker(runtime: FakeRuntime) {
  const toWorker: Listener[] = [];
  const toClient: Listener[] = [];
  const posted: SamRequest[] = [];
  const scope = {
    addEventListener: (_type: "message", listener: Listener) => toWorker.push(listener),
    postMessage: (message: SamReply) => {
      queueMicrotask(() => {
        for (const listener of toClient) listener({ data: message as never });
      });
    },
  };
  const worker = {
    addEventListener: (_type: "message", listener: Listener) => toClient.push(listener),
    postMessage: (message: SamRequest) => {
      posted.push(message);
      queueMicrotask(() => {
        for (const listener of toWorker) listener({ data: message as never });
      });
    },
    terminate: () => undefined,
  };
  startSamWorker(scope as never, {
    createEngine: (modelsUrl, onStage) => {
      return createInferenceEngine({
        runtime,
        cache: new FakeModelCache(),
        modelsUrl,
        onStage,
        hasGpuAdapter: () => Promise.resolve(true),
      });
    },
  });
  return { worker: worker as unknown as SamWorker, posted };
}

describe("inference worker client", () => {
  it("starts the worker, reports each graph and resolves ready", async () => {
    const stages: SamGraph[] = [];
    const { worker, posted } = linkedWorker(new FakeRuntime());
    const client = createSamClient({
      modelsUrl: "/models",
      spawn: () => worker,
      onStage: (graph) => stages.push(graph),
    });
    const ready = await client.ready;
    assert.equal(ready.provider, "webgpu");
    assert.deepEqual(stages, [samGraphs.decoder, samGraphs.encoderQ4]);
    assert.equal(posted[0]?.type, "init");
  });

  it("returns the stale outcome across the message boundary for an overtaken prompt", async () => {
    const runtime = new FakeRuntime();
    const { worker } = linkedWorker(runtime);
    const client = createSamClient({ modelsUrl: "/models", spawn: () => worker });
    await client.ready;
    await client.encode("view-a", new Float32Array(3 * 1024 * 1024));
    const decoder = runtime.session(samGraphs.decoder);
    decoder.hold = true;
    const point = { points: [{ x: 5, y: 6, positive: true }] };
    const first = client.prompt("view-a", point);
    await tick();
    const second = client.prompt("view-a", point);
    await tick();
    decoder.gates[0]?.resolve();
    assert.deepEqual(await first, { status: "stale" });
    await tick();
    decoder.gates[1]?.resolve();
    const answer = await second;
    assert.equal(answer.status, "answer");
  });

  it("rejects a request for an unknown embedding with the worker message", async () => {
    const { worker } = linkedWorker(new FakeRuntime());
    const client = createSamClient({ modelsUrl: "/models", spawn: () => worker });
    await client.ready;
    await assert.rejects(
      client.prompt("missing", { points: [] }),
      (error: Error) => error instanceof SamWorkerError && /missing/.test(error.message),
    );
  });

  it("rejects ready when a session cannot be created", async () => {
    const { worker } = linkedWorker(new FakeRuntime({ failProviders: ["webgpu", "wasm"] }));
    const client = createSamClient({ modelsUrl: "/models", spawn: () => worker });
    await assert.rejects(client.ready, SamWorkerError);
  });

  it("rejects pending requests and later ones after close", async () => {
    const { worker } = linkedWorker(new FakeRuntime());
    const client = createSamClient({ modelsUrl: "/models", spawn: () => worker });
    await client.ready;
    const pending = client.prompt("missing", { points: [] });
    client.close();
    await assert.rejects(pending);
    await assert.rejects(client.prompt("missing", { points: [] }), /closed/);
  });
});
