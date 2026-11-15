import { seededRandom, type TypingSet } from "../../src/index.ts";

export interface SyntheticSlideOptions {
  readonly seed: number;
  readonly nuclei: number;
  readonly dims: number;
  readonly classShares: readonly number[];
  readonly spread: number;
  readonly typerAccuracy: number;
  readonly stainShift: number;
}

export const syntheticSlideDefaults: SyntheticSlideOptions = {
  seed: 7,
  nuclei: 3400,
  dims: 24,
  classShares: [0.4, 0.25, 0.25, 0.1],
  spread: 2.5,
  typerAccuracy: 0.45,
  stainShift: 4,
};

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function pickClass(random: () => number, shares: readonly number[]): number {
  let roll = random();
  for (let c = 0; c < shares.length; c++) {
    roll -= shares[c] ?? 0;
    if (roll <= 0) return c;
  }
  return shares.length - 1;
}

export function syntheticSlide(overrides: Partial<SyntheticSlideOptions> = {}): TypingSet {
  const options = { ...syntheticSlideDefaults, ...overrides };
  const random = seededRandom(options.seed);
  const classes = options.classShares.length;
  const means = Array.from({ length: classes }, () =>
    Float32Array.from({ length: options.dims }, () => gaussian(random)),
  );
  const stain = Float32Array.from(
    { length: options.dims },
    () => gaussian(random) * options.stainShift,
  );
  const features: Float32Array[] = [];
  const typerLogs: Float32Array[] = [];
  const labels = new Uint8Array(options.nuclei);
  for (let i = 0; i < options.nuclei; i++) {
    const label = pickClass(random, options.classShares);
    labels[i] = label;
    const mean = means[label] ?? new Float32Array(options.dims);
    features.push(
      Float32Array.from(
        { length: options.dims },
        (_, d) => (mean[d] ?? 0) + (stain[d] ?? 0) + gaussian(random) * options.spread,
      ),
    );
    const right = random() < options.typerAccuracy;
    const wrong = (label + 1 + Math.floor(random() * (classes - 1))) % classes;
    const called = right ? label : wrong;
    const scores = Float64Array.from(
      { length: classes },
      (_, c) => (c === called ? 2 : 0) + gaussian(random) * 0.5,
    );
    const max = Math.max(...scores);
    const sum = scores.reduce((total, score) => total + Math.exp(score - max), 0);
    typerLogs.push(Float32Array.from(scores, (score) => score - max - Math.log(sum)));
  }
  return { classes, features, typerLogs, labels };
}
