import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, stdout } from "node:process";
import {
  sameImageTrial,
  summarise,
  type TrialScore,
  type TypingSet,
} from "../src/learner/same-image-protocol.ts";

const corrections = 200;
const seeds = [0, 1, 2];
const heldCount = 3000;
const heldStride = 3;
const floor = 1e-4;

function rows(bytes: Buffer, width: number): Float32Array[] {
  const flat = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return Array.from({ length: flat.length / width }, (_, index) =>
    flat.subarray(index * width, (index + 1) * width),
  );
}

function load(directory: string) {
  const labels = new Uint8Array(readFileSync(join(directory, "pathosam-train.labels.u8")));
  const featureBytes = readFileSync(join(directory, "pathosam-train.f32"));
  const dims = featureBytes.byteLength / 4 / labels.length;
  const probabilities = rows(readFileSync(join(directory, "monai-train.probs.f32")), 4);
  const set: TypingSet = {
    classes: 4,
    features: rows(featureBytes, dims),
    typerLogs: probabilities.map((row) =>
      Float32Array.from(row, (p) => Math.log(Math.max(floor, p))),
    ),
    labels,
  };
  const covered = new Uint8Array(readFileSync(join(directory, "monai-train.covered.u8")));
  const samples = JSON.parse(
    readFileSync(join(directory, "typing-samples.json"), "utf8"),
  ) as Record<string, number[]>;
  return { set, covered, samples, dims };
}

function main() {
  const directory = argv[2];
  if (directory === undefined) {
    stdout.write("Usage: node sam-bench/type-learner-same-images.ts PANNUKE_FIXTURE_DIR\n");
    return;
  }
  const { set, covered, samples, dims } = load(directory);
  const trials: TrialScore[] = [];
  for (const seed of seeds) {
    const chosen = samples[`${corrections}-${seed}`] ?? [];
    const taken = new Set(chosen);
    const held: number[] = [];
    for (let i = 0; i < set.labels.length && held.length < heldCount; i += heldStride) {
      if ((covered[i] ?? 0) !== 0 && !taken.has(i)) held.push(i);
    }
    const trial = sameImageTrial(set, chosen, held);
    trials.push(trial);
    stdout.write(
      `seed ${seed}: typer ${(trial.typer * 100).toFixed(1)}%, learner ${(trial.learner * 100).toFixed(1)}%, last correction ${trial.lastCorrectionMs.toFixed(1)} ms\n`,
    );
  }
  const score = summarise(corrections, trials);
  stdout.write(
    `${JSON.stringify({ dims: dims + set.classes, corrections, typer: score.typer, learner: score.learner, gain: score.gain, trials }, null, 1)}\n`,
  );
}

main();
