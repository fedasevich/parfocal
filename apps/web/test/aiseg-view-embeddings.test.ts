import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ViewToEmbed } from "@parfocal/api-client";
import type { SamEncoded } from "@parfocal/viewer-engine";
import type { PresetPatchReader } from "../src/aiseg/patch-reader.ts";
import { serverEmbeddingValues } from "../src/aiseg/server-embeddings.ts";
import {
  createEncoderSource,
  createViewEmbeddings,
  type EncoderSource,
  postViewEmbedding,
  type ViewEmbeddingPost,
  type ViewSam,
  viewEncoder,
  viewOf,
  withSeenLevels,
  withViewEmbeddings,
} from "../src/aiseg/view-embeddings.ts";

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

function clock(start = 1000) {
  let at = start;
  return { now: () => at, pass: (ms: number) => (at += ms) };
}

const never = () => new Promise<void>(() => undefined);

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
      wait: never,
    });
    const embedding = await views.embedding(slideId, view);
    assert.equal(embedding?.length, serverEmbeddingValues);
    assert.equal(embedding?.[0], 0.5);
    assert.deepEqual(asked, [view]);
  });

  it("gives up on a slow server, skips it for a while and comes back when it answers", async () => {
    const time = clock();
    let release: (body: ArrayBuffer) => void = () => undefined;
    let posts = 0;
    const post: ViewEmbeddingPost = () => {
      posts += 1;
      return posts === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(halves());
    };
    const views = createViewEmbeddings({
      post,
      now: time.now,
      wait: () => Promise.resolve(),
      retryAfterMs: 20_000,
    });
    assert.equal(await views.embedding(slideId, view), null);
    assert.equal(await views.embedding(slideId, view), null);
    assert.equal(posts, 1);
    release(halves());
    await Promise.resolve();
    await Promise.resolve();
    const warm = createViewEmbeddings({ post, now: time.now, wait: never });
    assert.equal((await warm.embedding(slideId, view))?.[0], 0.5);
    assert.equal((await views.embedding(slideId, view)) === null, false);
  });

  it("skips a failing server until the retry time passes", async () => {
    const time = clock();
    let posts = 0;
    const views = createViewEmbeddings({
      post: () => {
        posts += 1;
        return posts === 1 ? Promise.reject(new Error("503")) : Promise.resolve(halves());
      },
      now: time.now,
      wait: never,
      retryAfterMs: 20_000,
    });
    assert.equal(await views.embedding(slideId, view), null);
    time.pass(19_000);
    assert.equal(await views.embedding(slideId, view), null);
    assert.equal(posts, 1);
    time.pass(2000);
    assert.equal((await views.embedding(slideId, view))?.[0], 0.5);
  });

  it("refuses a short body", async () => {
    const views = createViewEmbeddings({
      post: () => Promise.resolve(new ArrayBuffer(12)),
      wait: never,
    });
    assert.equal(await views.embedding(slideId, view), null);
  });

  it("posts the view as JSON and refuses another encoder's answer", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const sent = (init: RequestInit | undefined) =>
      typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    const answer = (encoder: string) =>
      new Response(halves(), { status: 200, headers: { "Parfocal-Encoder": encoder } });
    let encoder = viewEncoder;
    const post = postViewEmbedding((input, init) => {
      seen.push({ url: typeof input === "string" ? input : "", init });
      return Promise.resolve(answer(encoder));
    });
    const body = await post(slideId, view);
    assert.equal(body.byteLength, serverEmbeddingValues * 2);
    assert.equal(seen[0]?.url, `/api/slides/${slideId}/embeddings/view`);
    assert.equal(seen[0]?.init?.method, "POST");
    assert.deepEqual(sent(seen[0]?.init), view);
    encoder = "pathosam-vit-b-histopathology-fp32";
    await assert.rejects(post(slideId, view));
    const refused = postViewEmbedding(() => Promise.resolve(new Response("", { status: 503 })));
    await assert.rejects(refused(slideId, view));
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
    answer: Float32Array<ArrayBuffer> | null | "throw",
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
    const { best, calls, asked, sources } = wrapped(new Float32Array(8).fill(0.5));
    await best.encode(id, pixels());
    assert.deepEqual(calls, [`adopt ${id} vit-l 0.5`]);
    assert.deepEqual(asked, [view]);
    assert.deepEqual(sources, ["server"]);
  });

  it("encodes in the browser when the server has no answer, throws or the decoder is missing", async () => {
    for (const { best, calls, sources } of [
      wrapped(null),
      wrapped("throw"),
      wrapped(new Float32Array(8), { failAdopt: true }),
      wrapped(new Float32Array(8), { downsample: undefined }),
    ]) {
      await best.encode(id, pixels());
      assert.equal(calls.at(-1), `encode ${id}`);
      assert.deepEqual(sources, ["browser"]);
    }
  });

  it("leaves ids of other slides and of region passes to the browser without a server call", async () => {
    const { best, calls, asked, sources } = wrapped(new Float32Array(8));
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
    signal.set("browser");
    signal.set("server");
    stop();
    signal.set("browser");
    assert.deepEqual(heard, ["browser", "server"]);
    assert.equal(signal.get(), "browser");
  });
});
