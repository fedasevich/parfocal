import { createTypeLearner, type LearnerSettings, type TypeLearner } from "./type-learner.ts";

export const learnerStateVersion = 1;
export const learnerVariant = "pooled-embedding-with-typer-logs";

export interface SavedLearner {
  readonly version: typeof learnerStateVersion;
  readonly variant: typeof learnerVariant;
  readonly dims: number;
  readonly classKeys: readonly string[];
  readonly keys: readonly string[];
  readonly labels: readonly number[];
  readonly offsets: string;
  readonly steps: string;
  readonly values: string;
}

const levels = 65535;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function floatsOf(text: string): Float32Array {
  const bytes = fromBase64(text);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

function quantize(rows: readonly Float32Array[], dims: number) {
  const offsets = new Float32Array(dims).fill(Number.POSITIVE_INFINITY);
  const highs = new Float32Array(dims).fill(Number.NEGATIVE_INFINITY);
  for (const row of rows) {
    for (let d = 0; d < dims; d++) {
      const value = row[d] ?? 0;
      offsets[d] = Math.min(offsets[d] ?? 0, value);
      highs[d] = Math.max(highs[d] ?? 0, value);
    }
  }
  const steps = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    if (rows.length === 0) offsets[d] = 0;
    const range = (highs[d] ?? 0) - (offsets[d] ?? 0);
    steps[d] = range > 0 ? range / levels : 0;
  }
  const values = new Uint16Array(rows.length * dims);
  rows.forEach((row, index) => {
    for (let d = 0; d < dims; d++) {
      const step = steps[d] ?? 0;
      values[index * dims + d] =
        step === 0 ? 0 : Math.round(((row[d] ?? 0) - (offsets[d] ?? 0)) / step);
    }
  });
  return { offsets, steps, values };
}

export function saveLearner(learner: TypeLearner, classKeys: readonly string[]): SavedLearner {
  const examples = learner.examples();
  const { offsets, steps, values } = quantize(
    examples.map((example) => example.feature),
    learner.dims,
  );
  return {
    version: learnerStateVersion,
    variant: learnerVariant,
    dims: learner.dims,
    classKeys: [...classKeys],
    keys: examples.map((example) => example.key),
    labels: examples.map((example) => example.label),
    offsets: toBase64(new Uint8Array(offsets.buffer)),
    steps: toBase64(new Uint8Array(steps.buffer)),
    values: toBase64(new Uint8Array(values.buffer)),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readSavedLearner(value: unknown): SavedLearner | null {
  if (!isRecord(value)) return null;
  const { version, variant, dims, classKeys, keys, labels, offsets, steps, values } = value;
  if (version !== learnerStateVersion || variant !== learnerVariant) return null;
  if (typeof dims !== "number" || !Number.isInteger(dims) || dims < 1) return null;
  if (!Array.isArray(classKeys) || !classKeys.every((key) => typeof key === "string")) return null;
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) return null;
  if (!Array.isArray(labels) || !labels.every((label) => Number.isInteger(label))) return null;
  if (keys.length !== labels.length) return null;
  if (typeof offsets !== "string" || typeof steps !== "string" || typeof values !== "string") {
    return null;
  }
  return {
    version: learnerStateVersion,
    variant: learnerVariant,
    dims,
    classKeys,
    keys,
    labels: labels as number[],
    offsets,
    steps,
    values,
  };
}

export function restoreLearner(
  saved: SavedLearner,
  dims: number,
  classKeys: readonly string[],
  settings: Partial<LearnerSettings> = {},
): TypeLearner | null {
  if (saved.dims !== dims) return null;
  let offsets: Float32Array;
  let steps: Float32Array;
  let bytes: Uint8Array;
  try {
    offsets = floatsOf(saved.offsets);
    steps = floatsOf(saved.steps);
    bytes = fromBase64(saved.values);
  } catch {
    return null;
  }
  const values = new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  if (
    offsets.length !== dims ||
    steps.length !== dims ||
    values.length !== saved.keys.length * dims
  ) {
    return null;
  }
  const learner = createTypeLearner(dims, classKeys.length, settings);
  saved.keys.forEach((key, index) => {
    const label = classKeys.indexOf(saved.classKeys[saved.labels[index] ?? -1] ?? "");
    if (label < 0) return;
    const feature = new Float32Array(dims);
    for (let d = 0; d < dims; d++) {
      feature[d] = (offsets[d] ?? 0) + (values[index * dims + d] ?? 0) * (steps[d] ?? 0);
    }
    learner.teach(key, feature, label);
  });
  learner.train();
  return learner;
}
