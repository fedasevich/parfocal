import { learnerInput } from "./features.ts";
import { argmax, createTypeLearner, type LearnerSettings } from "./type-learner.ts";

export interface TypingSet {
  readonly classes: number;
  readonly features: readonly Float32Array[];
  readonly typerLogs: readonly Float32Array[];
  readonly labels: ArrayLike<number>;
}

export interface TrialScore {
  readonly typer: number;
  readonly learner: number;
  readonly lastCorrectionMs: number;
}

export interface ProtocolScore {
  readonly corrections: number;
  readonly trials: readonly TrialScore[];
  readonly typer: number;
  readonly learner: number;
  readonly gain: number;
}

export interface ProtocolOptions {
  readonly corrections?: number;
  readonly draws?: number;
  readonly held?: number;
  readonly seed?: number;
  readonly settings?: Partial<LearnerSettings>;
  readonly now?: () => number;
}

export const protocolCorrections = 200;
export const protocolDraws = 3;
export const protocolHeld = 3000;

export function balancedAccuracy(
  predicted: ArrayLike<number>,
  truth: ArrayLike<number>,
  classes: number,
): number {
  const hits = new Float64Array(classes);
  const totals = new Float64Array(classes);
  for (let i = 0; i < truth.length; i++) {
    const label = truth[i] ?? 0;
    totals[label] = (totals[label] ?? 0) + 1;
    if (predicted[i] === label) hits[label] = (hits[label] ?? 0) + 1;
  }
  let sum = 0;
  let present = 0;
  for (let c = 0; c < classes; c++) {
    const total = totals[c] ?? 0;
    if (total === 0) continue;
    present += 1;
    sum += (hits[c] ?? 0) / total;
  }
  return present === 0 ? 0 : sum / present;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(count: number, random: () => number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i] ?? 0;
    order[i] = order[j] ?? 0;
    order[j] = swap;
  }
  return order;
}

function inputOf(set: TypingSet, index: number): Float32Array {
  return learnerInput(
    set.features[index] ?? new Float32Array(0),
    set.typerLogs[index] ?? new Float32Array(set.classes),
  );
}

export function sameImageTrial(
  set: TypingSet,
  corrections: readonly number[],
  held: readonly number[],
  settings: Partial<LearnerSettings> = {},
  now: () => number = () => performance.now(),
): TrialScore {
  const dims = (set.features[0]?.length ?? 0) + set.classes;
  const learner = createTypeLearner(dims, set.classes, settings);
  let lastCorrectionMs = 0;
  for (const index of corrections) {
    learner.teach(String(index), inputOf(set, index), set.labels[index] ?? 0);
    const started = now();
    learner.train();
    lastCorrectionMs = now() - started;
  }
  const truth = held.map((index) => set.labels[index] ?? 0);
  const typed = held.map((index) => argmax(set.typerLogs[index] ?? []));
  const learned = held.map((index, position) => {
    const prediction = learner.predict(inputOf(set, index));
    return prediction === null ? (typed[position] ?? 0) : argmax(prediction);
  });
  return {
    typer: balancedAccuracy(typed, truth, set.classes),
    learner: balancedAccuracy(learned, truth, set.classes),
    lastCorrectionMs,
  };
}

export function summarise(corrections: number, trials: readonly TrialScore[]): ProtocolScore {
  const mean = (pick: (trial: TrialScore) => number) =>
    trials.reduce((sum, trial) => sum + pick(trial), 0) / Math.max(1, trials.length);
  const typer = mean((trial) => trial.typer);
  const learner = mean((trial) => trial.learner);
  return { corrections, trials, typer, learner, gain: learner - typer };
}

export function sameImageProtocol(set: TypingSet, options: ProtocolOptions = {}): ProtocolScore {
  const corrections = options.corrections ?? protocolCorrections;
  const draws = options.draws ?? protocolDraws;
  const held = options.held ?? protocolHeld;
  const seed = options.seed ?? 0;
  const count = set.labels.length;
  if (count < corrections + 1) throw new RangeError("The set is smaller than the corrections");
  const trials: TrialScore[] = [];
  for (let draw = 0; draw < draws; draw++) {
    const order = shuffled(count, seededRandom(seed + draw));
    trials.push(
      sameImageTrial(
        set,
        order.slice(0, corrections),
        order.slice(corrections, corrections + held),
        options.settings,
        options.now,
      ),
    );
  }
  return summarise(corrections, trials);
}
