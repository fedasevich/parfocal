import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createInferenceEngine,
  EngineNotReadyError,
  type InferenceEngine,
  OtherEncoderEmbeddingError,
  samGraphs,
  UnknownEmbeddingError,
  UnsupportedGraphInputError,
} from "../../src/index.ts";
import {
  FakeModelCache,
  FakeRuntime,
  type FakeRuntimeOptions,
  FakeTensor,
  tick,
} from "./sam-fakes.ts";

const pixelCount = 3 * 1024 * 1024;
const decoderGraph = samGraphs.decoder;
const click = { points: [{ x: 300, y: 400, positive: true }] };

function build(
  options: FakeRuntimeOptions & {
    adapter?: boolean;
    capacity?: number;
    warm?: boolean;
    windowDecoder?: boolean;
  } = {},
) {
  const runtime = new FakeRuntime(options);
  const cache = new FakeModelCache();
  const engine = createInferenceEngine({
    runtime,
    cache,
    modelsUrl: "/models",
    hasGpuAdapter: () => Promise.resolve(options.adapter ?? true),
    ...(options.capacity === undefined ? {} : { embeddingCapacity: options.capacity }),
    ...(options.warm === undefined ? {} : { warm: options.warm }),
    ...(options.windowDecoder === undefined ? {} : { windowDecoder: options.windowDecoder }),
  });
  return { runtime, cache, engine };
}

async function started(engine: InferenceEngine, id = "view-a"): Promise<void> {
  await engine.init();
  await engine.encode(id, new Float32Array(pixelCount));
}

describe("inference engine provider choice", () => {
  it("loads the 4-bit encoder on WebGPU when an adapter answers", async () => {
    const { runtime, cache, engine } = build({ adapter: true });
    const ready = await engine.init();
    assert.equal(ready.provider, "webgpu");
    assert.equal(ready.fellBack, false);
    assert.deepEqual(cache.urls, [
      `/models/${samGraphs.decoder}`,
      `/models/${samGraphs.encoderQ4}`,
    ]);
    assert.deepEqual(
      runtime.created.map((entry) => entry.provider),
      ["webgpu", "webgpu"],
    );
  });

  it("loads the uint8 encoder on WebAssembly when no adapter answers", async () => {
    const { cache, engine } = build({ adapter: false });
    const ready = await engine.init();
    assert.equal(ready.provider, "wasm");
    assert.deepEqual(cache.urls, [
      `/models/${samGraphs.decoder}`,
      `/models/${samGraphs.encoderUint8}`,
    ]);
    assert.deepEqual(
      ready.loads.map((load) => load.message),
      ["Loaded from cache", "Loaded from cache"],
    );
  });

  it("falls back to WebAssembly and reports it when WebGPU fails", async () => {
    const { runtime, engine } = build({ adapter: true, failProviders: ["webgpu"] });
    const ready = await engine.init();
    assert.equal(ready.provider, "wasm");
    assert.equal(ready.fellBack, true);
    assert.equal(ready.loads.length, 2);
    assert.deepEqual(
      runtime.created.map((entry) => entry.provider),
      ["wasm", "wasm"],
    );
  });

  it("fails when WebAssembly itself cannot create a session", async () => {
    const { engine } = build({ adapter: false, failProviders: ["wasm"] });
    await assert.rejects(engine.init(), /no wasm/);
    await assert.rejects(
      engine.encode("view-a", new Float32Array(pixelCount)),
      EngineNotReadyError,
    );
  });
});

describe("inference engine session creation", () => {
  it("creates the decoder first and never two sessions at once", async () => {
    const { runtime, engine } = build({ createDelayMs: 10 });
    const [first, second] = await Promise.all([engine.init(), engine.init()]);
    assert.equal(first, second);
    assert.equal(runtime.maxInFlight, 1);
    assert.deepEqual(
      runtime.created.map((entry) => entry.graph),
      [samGraphs.decoder, samGraphs.encoderQ4],
    );
  });

  it("creates the AIS decoder once and never beside another session", async () => {
    const { runtime, engine } = build({ createDelayMs: 10 });
    await started(engine);
    await Promise.all([engine.segmentAll("view-a"), engine.segmentAll("view-a")]);
    assert.equal(runtime.maxInFlight, 1);
    const ais = runtime.created.filter((entry) => entry.graph === samGraphs.aisDecoderInt8Weights);
    assert.equal(ais.length, 1);
  });

  it("warms the decoder with one dummy click once the encoder is ready", async () => {
    const { runtime, engine } = build();
    const ready = await engine.init();
    assert.equal(ready.warmed, true);
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 1);
  });

  it("skips the dummy click when warming is off", async () => {
    const { runtime, engine } = build({ warm: false });
    const ready = await engine.init();
    assert.equal(ready.warmed, false);
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 0);
  });
});

describe("inference engine inputs", () => {
  it("names the encoder input from the graph", async () => {
    const { runtime, engine } = build();
    await started(engine);
    const feeds = runtime.session(samGraphs.encoderQ4).feedsSeen[0];
    assert.deepEqual(Object.keys(feeds ?? {}), ["pixel_values"]);
    assert.deepEqual(feeds?.["pixel_values"]?.dims, [1, 3, 1024, 1024]);
  });

  it("fills only the inputs the decoder graph declares", async () => {
    const { runtime, engine } = build({
      decoderInputs: ["image_embeddings", "point_coords", "point_labels", "orig_im_size"],
      warm: false,
    });
    await started(engine);
    await engine.prompt("view-a", click);
    const feeds = runtime.session(decoderGraph).feedsSeen[0];
    assert.deepEqual(Object.keys(feeds ?? {}), [
      "image_embeddings",
      "point_coords",
      "point_labels",
      "orig_im_size",
    ]);
  });

  it("refuses a decoder input it does not know and frees what it built", async () => {
    const { runtime, engine } = build({
      decoderInputs: ["image_embeddings", "point_coords", "boxes_extra"],
      warm: false,
    });
    await started(engine);
    const before = runtime.tensors.length;
    await assert.rejects(engine.prompt("view-a", click), UnsupportedGraphInputError);
    assert.ok(runtime.tensors.slice(before).every((tensor) => tensor.disposed));
  });

  it("pads a point prompt with a -1 label and sends a box as labels 2 and 3", async () => {
    const { runtime, engine } = build({ warm: false });
    await started(engine);
    await engine.prompt("view-a", click);
    await engine.prompt("view-a", {
      points: [{ x: 10, y: 20, positive: false }],
      box: { x0: 1, y0: 2, x1: 3, y1: 4 },
    });
    const [pointFeeds, boxFeeds] = runtime.session(decoderGraph).feedsSeen;
    assert.deepEqual([...(pointFeeds?.["point_labels"]?.data ?? [])], [1, -1]);
    assert.deepEqual(pointFeeds?.["point_coords"]?.dims, [1, 2, 2]);
    assert.deepEqual([...(boxFeeds?.["point_labels"]?.data ?? [])], [0, 2, 3]);
    assert.deepEqual([...(boxFeeds?.["point_coords"]?.data ?? [])], [10, 20, 1, 2, 3, 4]);
    assert.deepEqual([...(boxFeeds?.["has_mask_input"]?.data ?? [])], [0]);
  });

  it("feeds the previous logits through mask_input", async () => {
    const { runtime, engine } = build({ warm: false });
    await started(engine);
    const logits = new Float32Array(256 * 256).fill(0.5);
    await engine.prompt("view-a", { ...click, previousLogits: logits });
    const feeds = runtime.session(decoderGraph).feedsSeen[0];
    assert.deepEqual([...(feeds?.["has_mask_input"]?.data ?? [])], [1]);
    assert.deepEqual(feeds?.["mask_input"]?.dims, [1, 1, 256, 256]);
    assert.equal(feeds?.["mask_input"]?.data[0], 0.5);
  });

  it("rejects an encoder input of the wrong size", async () => {
    const { engine } = build();
    await engine.init();
    await assert.rejects(engine.encode("view-a", new Float32Array(12)), RangeError);
  });
});

describe("inference engine stale answers", () => {
  it("drops the answer of a prompt that a newer prompt overtook and skips the queued ones", async () => {
    const { runtime, engine } = build();
    await started(engine);
    const decoder = runtime.session(decoderGraph);
    const runsBefore = decoder.feedsSeen.length;
    decoder.hold = true;

    const first = engine.prompt("view-a", click);
    await tick();
    assert.equal(decoder.gates.length, 1);
    const second = engine.prompt("view-a", click);
    const third = engine.prompt("view-a", click);
    decoder.gates[0]?.resolve();
    assert.deepEqual(await first, { status: "stale" });
    assert.deepEqual(await second, { status: "stale" });

    await tick();
    assert.equal(decoder.gates.length, 2);
    decoder.gates[1]?.resolve();
    const answer = await third;
    assert.equal(answer.status, "answer");
    assert.equal(decoder.feedsSeen.length - runsBefore, 2);
  });

  it("answers a prompt that nothing overtook", async () => {
    const { engine } = build();
    await started(engine);
    const answer = await engine.prompt("view-a", click);
    assert.equal(answer.status, "answer");
    if (answer.status === "answer") {
      assert.deepEqual(Object.keys(answer.outputs).sort(), [
        "iou_predictions",
        "low_res_masks",
        "masks",
      ]);
    }
  });

  it("disposes the tensors of a dropped answer", async () => {
    const { runtime, engine } = build();
    await started(engine);
    const decoder = runtime.session(decoderGraph);
    decoder.hold = true;
    const first = engine.prompt("view-a", click);
    await tick();
    const feeds = decoder.feedsSeen.at(-1) ?? {};
    const second = engine.prompt("view-a", click);
    decoder.gates[0]?.resolve();
    assert.equal((await first).status, "stale");
    await tick();
    decoder.gates[1]?.resolve();
    assert.equal((await second).status, "answer");
    const built = Object.values(feeds).filter((tensor) => tensor instanceof FakeTensor);
    assert.ok(built.some((tensor) => tensor.disposed));
  });

  it("runs an encode after a held decode and never beside it", async () => {
    const { runtime, engine } = build();
    await started(engine);
    const decoder = runtime.session(decoderGraph);
    decoder.hold = true;
    const prompt = engine.prompt("view-a", click);
    await tick();
    const encode = engine.encode("view-b", new Float32Array(pixelCount));
    await tick();
    assert.equal(runtime.session(samGraphs.encoderQ4).feedsSeen.length, 1);
    decoder.gates[0]?.resolve();
    await prompt;
    await encode;
    assert.equal(runtime.session(samGraphs.encoderQ4).feedsSeen.length, 2);
  });
});

function windowAnswer(spills: boolean) {
  return () => {
    const lowSide = 128;
    const lowRes = new Float32Array(lowSide * lowSide).fill(-4);
    for (let y = 50; y < 70; y++) {
      for (let x = spills ? 0 : 50; x < 70; x++) {
        lowRes[y * lowSide + x] = 4;
      }
    }
    return {
      masks: new FakeTensor([1, 1, 512, 512], new Float32Array(512 * 512).fill(-4)),
      iou_predictions: new FakeTensor([1, 1], Float32Array.of(0.5)),
      low_res_masks: new FakeTensor([1, 1, lowSide, lowSide], lowRes),
    };
  };
}

describe("inference engine window decoder", () => {
  it("loads no window graph unless asked", async () => {
    const { cache, engine } = build();
    const ready = await engine.init();
    assert.equal(ready.windowed, false);
    assert.ok(!cache.urls.includes(`/models/${samGraphs.windowDecoder}`));
  });

  it("loads the window graph after the click decoder and warms it", async () => {
    const { runtime, engine } = build({ windowDecoder: true });
    const ready = await engine.init();
    assert.equal(ready.windowed, true);
    assert.deepEqual(
      runtime.created.map((entry) => entry.graph),
      [samGraphs.decoder, samGraphs.encoderQ4, samGraphs.windowDecoder],
    );
    assert.equal(runtime.session(samGraphs.windowDecoder).feedsSeen.length, 1);
  });

  it("decodes a click on the window around it and pastes the masks back", async () => {
    const { runtime, engine } = build({ windowDecoder: true, warm: false });
    await started(engine);
    const window = runtime.session(samGraphs.windowDecoder);
    window.respond = windowAnswer(false);
    const answer = await engine.prompt("view-a", click);
    assert.equal(answer.status, "answer");
    if (answer.status !== "answer") return;
    assert.equal(answer.path, "window");
    assert.deepEqual([...(window.feedsSeen[0]?.["window_origin"]?.data ?? [])], [3, 9]);
    assert.equal(window.feedsSeen[0]?.["orig_im_size"], undefined);
    assert.deepEqual(answer.outputs["low_res_masks"]?.dims, [1, 1, 256, 256]);
    assert.deepEqual(answer.outputs["masks"]?.dims, [1, 1, 1024, 1024]);
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 0);
  });

  it("reruns the full decoder when the window mask reaches the window edge", async () => {
    const { runtime, engine } = build({ windowDecoder: true, warm: false });
    await started(engine);
    runtime.session(samGraphs.windowDecoder).respond = windowAnswer(true);
    const answer = await engine.prompt("view-a", click);
    assert.equal(answer.status === "answer" && answer.path, "window-edge");
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 1);
  });

  it("sends a prompt too wide for the window to the full decoder", async () => {
    const { runtime, engine } = build({ windowDecoder: true, warm: false });
    await started(engine);
    const answer = await engine.prompt("view-a", {
      points: [
        { x: 50, y: 50, positive: true },
        { x: 900, y: 900, positive: false },
      ],
    });
    assert.equal(answer.status === "answer" && answer.path, "full");
    assert.equal(runtime.session(samGraphs.windowDecoder).feedsSeen.length, 0);
  });

  it("keeps working on the full decoder when the window graph is not published", async () => {
    const { runtime, engine } = build({
      windowDecoder: true,
      missingGraphs: [samGraphs.windowDecoder],
    });
    const ready = await engine.init();
    assert.equal(ready.windowed, false);
    await engine.encode("view-a", new Float32Array(pixelCount));
    const answer = await engine.prompt("view-a", click);
    assert.equal(answer.status === "answer" && answer.path, "full");
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 2);
  });

  it("releases the window session on close", async () => {
    const { runtime, engine } = build({ windowDecoder: true });
    await started(engine);
    await engine.close();
    assert.equal(runtime.session(samGraphs.windowDecoder).released, true);
  });
});

describe("inference engine embeddings", () => {
  it("keeps the newest embeddings up to the capacity and disposes the evicted one", async () => {
    const { engine } = build({ capacity: 2 });
    await engine.init();
    const pixels = () => new Float32Array(pixelCount);
    await engine.encode("a", pixels());
    await engine.encode("b", pixels());
    const third = await engine.encode("c", pixels());
    assert.deepEqual(third.evicted, ["a"]);
    assert.equal(engine.hasEmbedding("a"), false);
    assert.equal(engine.hasEmbedding("b"), true);
    await assert.rejects(engine.prompt("a", click), UnknownEmbeddingError);
  });

  it("treats a prompt as a use that protects the embedding from eviction", async () => {
    const { engine } = build({ capacity: 2 });
    await engine.init();
    await engine.encode("a", new Float32Array(pixelCount));
    await engine.encode("b", new Float32Array(pixelCount));
    await engine.prompt("a", click);
    const third = await engine.encode("c", new Float32Array(pixelCount));
    assert.deepEqual(third.evicted, ["b"]);
  });

  it("drops an embedding on request", async () => {
    const { engine } = build();
    await started(engine);
    engine.drop("view-a");
    assert.equal(engine.hasEmbedding("view-a"), false);
  });

  it("releases every session on close", async () => {
    const { runtime, engine } = build();
    await started(engine);
    await engine.segmentAll("view-a");
    await engine.close();
    assert.ok(runtime.created.every((entry) => entry.session.released));
    assert.equal(engine.hasEmbedding("view-a"), false);
    await assert.rejects(engine.prompt("view-a", click), EngineNotReadyError);
  });
});

describe("inference engine adopted embeddings", () => {
  const embeddingCount = 256 * 64 * 64;

  it("decodes a prompt on an adopted embedding without running the encoder", async () => {
    const { runtime, engine } = build();
    await engine.init();
    const encoderRuns = runtime.session(samGraphs.encoderQ4).feedsSeen.length;
    const adopted = await engine.adopt("tile-a", new Float32Array(embeddingCount).fill(0.25));
    assert.deepEqual(adopted.evicted, []);
    assert.equal(engine.hasEmbedding("tile-a"), true);
    const outcome = await engine.prompt("tile-a", click);
    assert.equal(outcome.status, "answer");
    assert.equal(runtime.session(samGraphs.encoderQ4).feedsSeen.length, encoderRuns);
    const fed = runtime.session(decoderGraph).feedsSeen.at(-1)?.["image_embeddings"];
    assert.deepEqual(fed?.dims, [1, 256, 64, 64]);
    assert.equal(fed?.data[0], 0.25);
  });

  it("evicts the oldest embedding when an adopted one overfills the cache", async () => {
    const { engine } = build({ capacity: 1 });
    await started(engine, "view-a");
    const adopted = await engine.adopt("tile-a", new Float32Array(embeddingCount));
    assert.deepEqual(adopted.evicted, ["view-a"]);
    assert.equal(engine.hasEmbedding("view-a"), false);
  });

  it("refuses an embedding of the wrong size", async () => {
    const { engine } = build();
    await engine.init();
    await assert.rejects(engine.adopt("tile-a", new Float32Array(12)), RangeError);
  });
});

describe("inference engine ViT-L embeddings from the server", () => {
  const embeddingCount = 256 * 64 * 64;
  const large = () => new Float32Array(embeddingCount).fill(0.5);

  it("decodes a ViT-L embedding with the ViT-L decoder and a browser one with ViT-B", async () => {
    const { runtime, cache, engine } = build({ warm: false });
    await started(engine, "view-b");
    assert.equal(cache.urls.includes(`/models/${samGraphs.largeDecoder}`), false);
    await engine.adopt("view-l", large(), "vit-l");
    assert.equal(cache.urls.includes(`/models/${samGraphs.largeDecoder}`), true);
    await engine.prompt("view-l", click);
    assert.equal(runtime.session(samGraphs.largeDecoder).feedsSeen.length, 1);
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 0);
    assert.equal(
      runtime.session(samGraphs.largeDecoder).feedsSeen[0]?.["image_embeddings"]?.data[0],
      0.5,
    );
    await engine.prompt("view-b", click);
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 1);
    assert.equal(runtime.session(samGraphs.largeDecoder).feedsSeen.length, 1);
  });

  it("uses the ViT-L window decoder near the click when windows are on", async () => {
    const { runtime, engine } = build({ warm: false, windowDecoder: true });
    await engine.init();
    await engine.adopt("view-l", large(), "vit-l");
    const outcome = await engine.prompt("view-l", click);
    assert.equal(outcome.status, "answer");
    assert.equal(runtime.session(samGraphs.largeWindowDecoder).feedsSeen.length, 1);
    assert.equal(runtime.session(samGraphs.windowDecoder).feedsSeen.length, 0);
  });

  it("refuses to adopt when the ViT-L decoder cannot load and keeps nothing", async () => {
    const { engine } = build({ missingGraphs: [samGraphs.largeDecoder] });
    await engine.init();
    await assert.rejects(engine.adopt("view-l", large(), "vit-l"));
    assert.equal(engine.hasEmbedding("view-l"), false);
    await engine.encode("view-l", new Float32Array(pixelCount));
    assert.equal((await engine.prompt("view-l", click)).status, "answer");
  });

  it("goes back to the ViT-B decoder when the browser encodes the same view again", async () => {
    const { runtime, engine } = build({ warm: false });
    await engine.init();
    await engine.adopt("view-a", large(), "vit-l");
    await engine.encode("view-a", new Float32Array(pixelCount));
    await engine.prompt("view-a", click);
    assert.equal(runtime.session(decoderGraph).feedsSeen.length, 1);
    assert.equal(runtime.session(samGraphs.largeDecoder).feedsSeen.length, 0);
  });

  it("never feeds a ViT-L embedding to the ViT-B nucleus decoder or the learner", async () => {
    const { engine } = build();
    await engine.init();
    await engine.adopt("view-l", large(), "vit-l");
    await assert.rejects(engine.segmentAll("view-l"), OtherEncoderEmbeddingError);
    assert.throws(() => engine.pool("view-l", []), OtherEncoderEmbeddingError);
    engine.drop("view-l");
    await engine.adopt("view-l", large());
    assert.deepEqual(engine.pool("view-l", []), []);
  });
});
