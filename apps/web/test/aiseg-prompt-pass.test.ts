import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type BatchDecoder,
  dropDuplicates,
  ensemblePoints,
  maskBounds,
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

  it("averages five prompts per nucleus in best quality and keeps the averaged outline", async () => {
    const prompted: Seed[] = [];
    const shifted: BatchDecoder = (seeds) => {
      prompted.push(...seeds);
      return Promise.resolve(
        seeds.map((seed): PromptMask => {
          const disc = discs.find((candidate) => inDisc(candidate, seed[0], seed[1]));
          if (disc === undefined) return { mask: null, score: 0, stability: 0 };
          const logits = new Float32Array(size * size);
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const reach = disc.r + 2 - Math.hypot(x - seed[0], y - seed[1]) * 0.25;
              const inside = Math.hypot(x - disc.x, y - disc.y) - reach;
              logits[y * size + x] = -inside * 4;
            }
          }
          const mask = new Uint8Array(size * size);
          logits.forEach((value, p) => {
            if (value > 0) mask[p] = 1;
          });
          return { mask, score: 0.9, stability: 0.95, logits };
        }),
      );
    };
    const fast = await promptPass(image(), shifted, { ...options, batch: 16 });
    const best = await promptPass(image(), shifted, { ...options, batch: 16, ensemble: 4 });
    assert.equal(best.nuclei.length, discs.length);
    assert.equal(best.decodes - fast.decodes, discs.length * 5);
    for (const nucleus of best.nuclei) {
      const disc = discs.find((candidate) => inDisc(candidate, nucleus.seed[0], nucleus.seed[1]));
      assert.ok(disc !== undefined);
      const before = fast.nuclei.find(
        (other) => other.seed[0] === nucleus.seed[0] && other.seed[1] === nucleus.seed[1],
      );
      assert.equal(before?.stability, 0.95);
      assert.ok(nucleus.stability > 0.8 && nucleus.stability < 0.95);
    }
  });

  it("picks four points inside the mask around its centre plus the seed", () => {
    const mask = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++)
        if (inDisc({ x: 60, y: 60, r: 10 }, x, y)) mask[y * size + x] = 1;
    }
    const area = mask.reduce((sum, value) => sum + value, 0);
    const nucleus = {
      mask,
      area,
      seed: [58, 61] as Seed,
      score: 1,
      stability: 1,
      bounds: maskBounds(mask, size),
    };
    const points = ensemblePoints(nucleus, size, 4);
    assert.equal(points.length, 5);
    assert.deepEqual(points.at(-1), [58, 61]);
    for (const [x, y] of points) assert.equal(mask[y * size + x], 1);
  });

  it("drops the less confident of two masks that overlap at IoU over 0.5", () => {
    const disc = (cx: number) => {
      const mask = new Uint8Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++)
          if (inDisc({ x: cx, y: 60, r: 10 }, x, y)) mask[y * size + x] = 1;
      }
      return mask;
    };
    const nucleus = (cx: number, score: number) => {
      const mask = disc(cx);
      return {
        mask,
        area: mask.reduce((sum, value) => sum + value, 0),
        seed: [cx, 60] as Seed,
        score,
        stability: 1,
        bounds: maskBounds(mask, size),
      };
    };
    const kept = dropDuplicates([nucleus(60, 0.5), nucleus(62, 0.9), nucleus(90, 0.4)], size);
    assert.deepEqual(
      kept.map((item) => item.seed[0]),
      [62, 90],
    );
  });

  it("scales seeds and areas with the pixel size and adds the residual pass in best quality", () => {
    const fast = promptPassOptionsFor(0.5, "fast");
    const best = promptPassOptionsFor(0.25, "best");
    assert.equal(fast.residual, false);
    assert.equal(best.residual, true);
    assert.equal(fast.ensemble, 0);
    assert.equal(best.ensemble, 4);
    assert.equal(best.seedRadius, 14);
    assert.ok(fast.maxArea < best.maxArea);
    assert.equal(best.minStability, 0.8);
  });
});
