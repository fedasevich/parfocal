import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ViewToEmbed } from "@parfocal/api-client";
import type { SamEncoded } from "@parfocal/viewer-engine";
import type { PresetPatchReader } from "../src/aiseg/patch-reader.ts";
import { serverEmbeddingValues } from "../src/aiseg/server-embeddings.ts";
import {
  BestRefusedError,
  createEncoderSource,
  createViewEmbeddings,
  type EncoderSource,
  postViewEmbedding,
  type ViewAnswer,
  type ViewEmbeddingPost,
  type ViewSam,
  viewEncoder,
  viewOf,
  withSeenLevels,
  withViewEmbeddings,
} from "../src/aiseg/view-embeddings.ts";
import { GpuCallCancelledError, gpuWaits } from "../src/gpu/gpu-wait.ts";

const slideId = "6f1c0c1e-0000-4000-8000-000000000001";
const slide = { width: 8192, height: 6144 };
const view: ViewToEmbed = { x: 1024, y: 2048, width: 512, height: 512 };

function halves(): ArrayBuffer {
  const data = new DataView(new ArrayBuffer(serverEmbeddingValues * 2));
  for (let index = 0; index < serverEmbeddingValues; index++) {
    data.setUint16(index * 2, 0x3800, true);
  }
  return data.buffer;
}

const first = (answer: ViewAnswer) => ("embedding" in answer ? answer.embedding[0] : null);
const reason = (answer: ViewAnswer) => ("fallback" in answer ? answer.fallback : null);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function recordingSam(failAdopt = false) {
  const calls: string[] = [];
  const done = (id: string): SamEncoded => ({ id, ms: 1, evicted: [] });
  const sam: ViewSam = {
    encode(id) {
      calls.push(`encode ${id}`);
      return Promise.resolve(done(id));
    },
    adopt(id, embedding, model) {
      calls.push(`adopt ${id} ${model ?? "vit-b"} ${embedding[0]}`);
      return failAdopt ? Promise.reject(new Error("no decoder")) : Promise.resolve(done(id));
    },
  };
  return { sam, calls };
}

describe("live ViT-L view embeddings", () => {
  it("decodes the server's float16 answer", async () => {
    const asked: ViewToEmbed[] = [];
    const views = createViewEmbeddings({
      post: (_, sent) => {
        asked.push(sent);
        return Promise.resolve(halves());
      },
    });
    assert.equal(first(await views.embedding(slideId, view)), 0.5);
    assert.deepEqual(asked, [view]);
  });

  it("waits for a slow server past the old six seconds and answers once it is warm", async () => {
    let release: (body: ArrayBuffer) => void = () => undefined;
    const views = createViewEmbeddings({
      post: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      giveUpMs: 1000,
    });
    const pending = views.embedding(slideId, view);
    await tick(20);
    release(halves());
    assert.equal(first(await pending), 0.5);
  });

  it("asks again on the next click after a failure, with no silent pause", async () => {
    let posts = 0;
    const views = createViewEmbeddings({
      post: () => {
        posts += 1;
        return posts === 1
          ? Promise.reject(new BestRefusedError("offline"))
          : Promise.resolve(halves());
      },
    });
    assert.equal(reason(await views.embedding(slideId, view)), "offline");
    assert.equal(first(await views.embedding(slideId, view)), 0.5);
    assert.equal(posts, 2);
  });

  it("names why Best fell back", async () => {
    const answer = async (post: ViewEmbeddingPost, giveUpMs = 1000) =>
      reason(await createViewEmbeddings({ post, giveUpMs }).embedding(slideId, view));
    assert.equal(await answer(() => Promise.reject(new BestRefusedError("refused"))), "refused");
    assert.equal(await answer(() => Promise.reject(new GpuCallCancelledError())), "cancelled");
    assert.equal(await answer(() => Promise.reject(new TypeError("network"))), "offline");
    assert.equal(await answer(() => Promise.resolve(new ArrayBuffer(12))), "refused");
    const hanging: ViewEmbeddingPost = (_, __, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new GpuCallCancelledError())),
      );
    assert.equal(await answer(hanging, 10), "gave-up");
  });

  it("polls a waiting server with the call token until the embedding arrives", async () => {
    const urls: string[] = [];
    const post = postViewEmbedding(
      (input) => {
        urls.push(typeof input === "string" ? input : "");
        const waiting = { state: "waiting", call: "token-1", waited_seconds: 20, hold_seconds: 20 };
        return Promise.resolve(
          urls.length === 1
            ? new Response(JSON.stringify(waiting), { status: 202 })
            : new Response(halves(), { status: 200, headers: { "Parfocal-Encoder": viewEncoder } }),
        );
      },
      () => Promise.resolve(),
    );
    const body = await post(slideId, view, new AbortController().signal);
    assert.equal(body.byteLength, serverEmbeddingValues * 2);
    assert.deepEqual(urls, [
      `/api/slides/${slideId}/embeddings/view`,
      `/api/slides/${slideId}/embeddings/view?call=token-1`,
    ]);
  });

  it("shows the GPU wait while the first answer is still held and stops when it comes", async () => {
    let release: (response: Response) => void = () => undefined;
    const post = postViewEmbedding(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      () => Promise.resolve(),
      5,
    );
    const pending = post(slideId, view, new AbortController().signal);
    await tick(30);
    assert.deepEqual(
      gpuWaits.current().map((wait) => wait.kind),
      ["encoder"],
    );
    release(new Response(halves(), { status: 200, headers: { "Parfocal-Encoder": viewEncoder } }));
    await pending;
    assert.deepEqual(gpuWaits.current(), []);
  });

  it("posts the view as JSON and tells a refusal from an offline GPU", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const sent = (init: RequestInit | undefined) =>
      typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    const answer = (encoder: string) =>
      new Response(halves(), { status: 200, headers: { "Parfocal-Encoder": encoder } });
    let encoder = viewEncoder;
    const signal = new AbortController().signal;
    const post = postViewEmbedding((input, init) => {
      seen.push({ url: typeof input === "string" ? input : "", init });
      return Promise.resolve(answer(encoder));
    });
    const body = await post(slideId, view, signal);
    assert.equal(body.byteLength, serverEmbeddingValues * 2);
    assert.equal(seen[0]?.url, `/api/slides/${slideId}/embeddings/view`);
    assert.equal(seen[0]?.init?.method, "POST");
    assert.deepEqual(sent(seen[0]?.init), view);
    encoder = "pathosam-vit-b-histopathology-fp32";
    await assert.rejects(post(slideId, view, signal), { reason: "refused" });
    const status = (code: number) =>
      postViewEmbedding(() => Promise.resolve(new Response("", { status: code })));
    await assert.rejects(status(503)(slideId, view, signal), { reason: "offline" });
    await assert.rejects(status(404)(slideId, view, signal), { reason: "refused" });
  });
});

describe("the slide rectangle of a view", () => {
  it("scales a level window to full resolution pixels", () => {
    const window = { level: 1, x: 256, y: 512, width: 256, height: 256 };
    assert.deepEqual(viewOf(window, 4, slide), { x: 1024, y: 2048, width: 1024, height: 1024 });
  });

  it("stops at the slide edge and refuses a view the server would not read", () => {
    const edge = { level: 0, x: 7936, y: 0, width: 512, height: 512 };
    assert.deepEqual(viewOf(edge, 1, slide), { x: 7936, y: 0, width: 256, height: 512 });
    assert.equal(viewOf({ level: 3, x: 0, y: 0, width: 512, height: 512 }, 32, slide), null);
    assert.equal(viewOf({ level: 0, x: 8190, y: 0, width: 512, height: 512 }, 1, slide), null);
    assert.equal(viewOf(edge, 1, { width: 0, height: 0 }), null);
  });
});

describe("Best outlines with the server embedding and falls back to the browser", () => {
  const id = `${slideId}:0|1024|2048|512|512`;
  const pixels = () => new Float32Array(4);

  function wrapped(
    answer: ViewAnswer | "throw",
    options: { failAdopt?: boolean; downsample?: number | undefined } = {},
  ) {
    const { sam, calls } = recordingSam(options.failAdopt);
    const asked: ViewToEmbed[] = [];
    const sources: EncoderSource[] = [];
    const best = withViewEmbeddings(sam, {
      views: {
        embedding(_, sent) {
          asked.push(sent);
          return answer === "throw" ? Promise.reject(new Error("down")) : Promise.resolve(answer);
        },
      },
      slideId,
      slide,
      downsampleOf: () => ("downsample" in options ? options.downsample : 1),
      onSource: (source) => sources.push(source),
    });
    return { best, calls, asked, sources };
  }

  it("adopts the ViT-L embedding and never runs the browser encoder", async () => {
    const { best, calls, asked, sources } = wrapped({ embedding: new Float32Array(8).fill(0.5) });
    await best.encode(id, pixels());
    assert.deepEqual(calls, [`adopt ${id} vit-l 0.5`]);
    assert.deepEqual(asked, [view]);
    assert.deepEqual(sources, ["asking", "server"]);
  });

  it("encodes in the browser and says why when the server cannot answer", async () => {
    for (const [answer, options, said] of [
      [{ fallback: "refused" }, {}, ["asking", "refused"]],
      [{ fallback: "cancelled" }, {}, ["asking", "cancelled"]],
      ["throw", {}, ["asking", "unsendable"]],
      [{ embedding: new Float32Array(8) }, { failAdopt: true }, ["asking", "unsendable"]],
      [{ embedding: new Float32Array(8) }, { downsample: undefined }, ["unsendable"]],
    ] as const) {
      const { best, calls, sources } = wrapped(answer, options);
      await best.encode(id, pixels());
      assert.equal(calls.at(-1), `encode ${id}`);
      assert.deepEqual(sources, said);
    }
  });

  it("leaves ids of other slides and of region passes to the browser without a server call", async () => {
    const { best, calls, asked, sources } = wrapped({ embedding: new Float32Array(8) });
    await best.encode("region:1:0", pixels());
    await best.encode(`${slideId}:3:0|0|0|512|512`, pixels());
    assert.deepEqual(calls, ["encode region:1:0", `encode ${slideId}:3:0|0|0|512|512`]);
    assert.deepEqual(asked, []);
    assert.deepEqual(sources, []);
  });

  it("remembers each level's downsample as patches are read", async () => {
    const seen = new Map<number, number>();
    const patch = { level: 2, downsample: 16 };
    const reader = withSeenLevels(
      { read: () => Promise.resolve({ patch }) } as unknown as PresetPatchReader,
      seen,
    );
    await reader.read({ preset: "tissue", x: 0, y: 0 });
    assert.equal(seen.get(2), 16);
  });

  it("tells subscribers where the last view was encoded", () => {
    const signal = createEncoderSource();
    const heard: EncoderSource[] = [];
    const stop = signal.subscribe((source) => heard.push(source));
    assert.equal(signal.get(), null);
    signal.set("offline");
    signal.set("server");
    stop();
    signal.set("cancelled");
    assert.deepEqual(heard, ["offline", "server"]);
    assert.equal(signal.get(), "cancelled");
  });
});
