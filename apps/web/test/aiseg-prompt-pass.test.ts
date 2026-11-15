import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BatchDecoder,
  type PatchImage,
  type PromptMask,
  promptPass,
  promptPassDefaults,
  promptPassOptionsFor,
  type Seed,
  stabilityScore,
  stainSeeds,
} from "../src/aiseg/prompt-pass.ts";

interface Disc {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

const size = 128;
const discs: Disc[] = [
  { x: 30, y: 30, r: 12 },
  { x: 90, y: 34, r: 8 },
  { x: 40, y: 92, r: 10 },
  { x: 96, y: 96, r: 6 },
];

function inDisc(disc: Disc, x: number, y: number) {
  return (x - disc.x) ** 2 + (y - disc.y) ** 2 <= disc.r ** 2;
}

function image(): PatchImage {
  const rgb = new Uint8Array(size * size * 3).fill(235);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (discs.some((disc) => inDisc(disc, x, y)))
        rgb.fill(60, (y * size + x) * 3, (y * size + x + 1) * 3);
    }
  }
  return { rgb, width: size, height: size };
}

function discDecoder(stabilityOf: (disc: Disc) => number, batches: number[]): BatchDecoder {
  return (seeds: readonly Seed[]) => {
    batches.push(seeds.length);
    return Promise.resolve(
      seeds.map((seed): PromptMask => {
        const disc = discs.find((candidate) => inDisc(candidate, seed[0], seed[1]));
        if (disc === undefined) return { mask: null, score: 0, stability: 0 };
        const mask = new Uint8Array(size * size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) if (inDisc(disc, x, y)) mask[y * size + x] = 1;
        }
        return { mask, score: 0.9, stability: stabilityOf(disc) };
      }),
    );
  };
}

const options = { ...promptPassDefaults, seedRadius: 6, minArea: 20, batch: 2 };

describe("prompt pass", () => {
  it("scores stability as the share of the mask that survives the logit moving from -1 to +1", () => {
    assert.equal(stabilityScore(new Float32Array([2, 2, 0.5, -0.5, -3])), 0.5);
    assert.equal(stabilityScore(new Float32Array([-5, -5])), 0);
  });

  it("seeds every nucleus from the stain, strongest first", () => {
    const seeds = stainSeeds(image(), options);
    for (const disc of discs) {
      assert.ok(seeds.some((seed) => inDisc(disc, seed[0], seed[1])));
    }
    assert.ok(seeds.every((seed) => discs.some((disc) => inDisc(disc, seed[0], seed[1]))));
    const first = seeds[0];
    assert.ok(first !== undefined && inDisc(discs[0] as Disc, first[0], first[1]));
  });

  it("finds no seeds on a flat patch", () => {
    const flat = { rgb: new Uint8Array(size * size * 3).fill(200), width: size, height: size };
    assert.deepEqual(stainSeeds(flat, options), []);
  });

  it("decodes in batches and keeps every stable mask once", async () => {
    const batches: number[] = [];
    const outcome = await promptPass(
      image(),
      discDecoder(() => 0.95, batches),
      options,
    );
    assert.equal(outcome.nuclei.length, discs.length);
    assert.equal(outcome.decodes, discs.length);
    assert.ok(batches.every((count) => count <= options.batch));
  });

  it("rejects masks with stability under 0.8", async () => {
    const outcome = await promptPass(
      image(),
      discDecoder((disc) => (disc.r === 8 ? 0.79 : 0.8), []),
      options,
    );
    assert.equal(outcome.nuclei.length, discs.length - 1);
    assert.ok(outcome.nuclei.every((nucleus) => nucleus.stability >= 0.8));
  });

  it("skips seeds already inside an accepted nucleus before decoding them", async () => {
    const big: Disc = { x: 64, y: 64, r: 30 };
    const rgb = new Uint8Array(size * size * 3).fill(235);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const peanut =
          inDisc({ x: 50, y: 64, r: 14 }, x, y) || inDisc({ x: 76, y: 64, r: 14 }, x, y);
        if (peanut) rgb.fill(60, (y * size + x) * 3, (y * size + x + 1) * 3);
      }
    }
    const whole: BatchDecoder = (seeds) =>
      Promise.resolve(
        seeds.map(() => {
          const mask = new Uint8Array(size * size);
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) if (inDisc(big, x, y)) mask[y * size + x] = 1;
          }
          return { mask, score: 1, stability: 1 };
        }),
      );
    const outcome = await promptPass({ rgb, width: size, height: size }, whole, {
      ...options,
      batch: 1,
      maxArea: 10_000,
    });
    assert.equal(outcome.nuclei.length, 1);
    assert.ok(outcome.seeds >= 2);
    assert.equal(outcome.decodes, 1);
  });

  it("scales seeds and areas with the pixel size and adds the residual pass in best quality", () => {
    const fast = promptPassOptionsFor(0.5, "fast");
    const best = promptPassOptionsFor(0.25, "best");
    assert.equal(fast.residual, false);
    assert.equal(best.residual, true);
    assert.equal(best.seedRadius, 14);
    assert.ok(fast.maxArea < best.maxArea);
    assert.equal(best.minStability, 0.8);
  });
});
