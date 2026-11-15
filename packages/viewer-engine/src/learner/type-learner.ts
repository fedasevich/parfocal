export interface LearnerSettings {
  readonly l2: number;
  readonly rate: number;
  readonly fullIterations: number;
  readonly warmIterations: number;
  readonly minExamples: number;
  readonly restandardizeGrowth: number;
}

export const learnerDefaults: LearnerSettings = {
  l2: 1e-2,
  rate: 0.05,
  fullIterations: 150,
  warmIterations: 25,
  minExamples: 8,
  restandardizeGrowth: 1.5,
};

export interface LearnerExample {
  readonly key: string;
  readonly feature: Float32Array;
  readonly label: number;
}

export interface TypeLearner {
  readonly dims: number;
  readonly classes: number;
  readonly count: number;
  readonly ready: boolean;
  readonly trained: boolean;
  teach(key: string, feature: Float32Array, label: number): void;
  forget(key: string): boolean;
  train(iterations?: number): number;
  predict(feature: Float32Array): Float32Array | null;
  examples(): LearnerExample[];
}

const beta1 = 0.9;
const beta2 = 0.999;
const epsilon = 1e-8;
const minVariance = 1e-6;

export function createTypeLearner(
  dims: number,
  classes: number,
  settings: Partial<LearnerSettings> = {},
): TypeLearner {
  if (!Number.isInteger(dims) || dims < 1) throw new RangeError("A learner needs features");
  if (!Number.isInteger(classes) || classes < 2)
    throw new RangeError("A learner needs two classes");
  const options: LearnerSettings = { ...learnerDefaults, ...settings };
  const size = classes * dims;
  const examples = new Map<string, LearnerExample>();
  const weights = new Float64Array(size);
  const bias = new Float64Array(classes);
  const mean = new Float64Array(dims);
  const scale = new Float64Array(dims).fill(1);
  const moment = new Float64Array(size);
  const velocity = new Float64Array(size);
  const biasMoment = new Float64Array(classes);
  const biasVelocity = new Float64Array(classes);
  let steps = 0;
  let trainedOn = 0;

  const labelsSeen = () => new Set([...examples.values()].map((example) => example.label)).size;
  const isReady = () => examples.size >= options.minExamples && labelsSeen() >= 2;

  function standardize(rows: readonly LearnerExample[]) {
    const n = rows.length;
    const squares = new Float64Array(dims);
    mean.fill(0);
    for (const { feature } of rows) {
      for (let d = 0; d < dims; d++) {
        const value = feature[d] ?? 0;
        mean[d] = (mean[d] ?? 0) + value / n;
        squares[d] = (squares[d] ?? 0) + (value * value) / n;
      }
    }
    for (let d = 0; d < dims; d++) {
      const centre = mean[d] ?? 0;
      scale[d] = 1 / Math.sqrt(Math.max((squares[d] ?? 0) - centre * centre, minVariance));
    }
  }

  function standardized(feature: Float32Array): Float64Array {
    const out = new Float64Array(dims);
    for (let d = 0; d < dims; d++) out[d] = ((feature[d] ?? 0) - (mean[d] ?? 0)) * (scale[d] ?? 1);
    return out;
  }

  function scores(x: Float64Array, out: Float64Array) {
    for (let c = 0; c < classes; c++) {
      let sum = bias[c] ?? 0;
      const row = c * dims;
      for (let d = 0; d < dims; d++) sum += (weights[row + d] ?? 0) * (x[d] ?? 0);
      out[c] = sum;
    }
  }

  function softmaxInPlace(z: Float64Array, allowed: (c: number) => boolean): number {
    let max = Number.NEGATIVE_INFINITY;
    for (let c = 0; c < classes; c++) if (allowed(c)) max = Math.max(max, z[c] ?? 0);
    let sum = 0;
    for (let c = 0; c < classes; c++) {
      const value = allowed(c) ? Math.exp((z[c] ?? 0) - max) : 0;
      z[c] = value;
      sum += value;
    }
    return sum;
  }

  function adam(
    parameters: Float64Array,
    gradient: Float64Array,
    first: Float64Array,
    second: Float64Array,
    total: number,
    penalty: number,
  ) {
    const correction1 = 1 - beta1 ** steps;
    const correction2 = 1 - beta2 ** steps;
    for (let k = 0; k < parameters.length; k++) {
      const value = parameters[k] ?? 0;
      const g = (gradient[k] ?? 0) / total + penalty * value;
      const m = beta1 * (first[k] ?? 0) + (1 - beta1) * g;
      const v = beta2 * (second[k] ?? 0) + (1 - beta2) * g * g;
      first[k] = m;
      second[k] = v;
      parameters[k] =
        value - (options.rate * (m / correction1)) / (Math.sqrt(v / correction2) + epsilon);
    }
  }

  function train(iterations?: number): number {
    if (!isReady()) return 0;
    const rows = [...examples.values()];
    const n = rows.length;
    const fresh = trainedOn === 0;
    if (fresh || n > trainedOn * options.restandardizeGrowth) standardize(rows);
    const count = iterations ?? (fresh ? options.fullIterations : options.warmIterations);
    const inputs = rows.map((row) => standardized(row.feature));
    const perClass = new Float64Array(classes);
    for (const row of rows) perClass[row.label] = (perClass[row.label] ?? 0) + 1;
    const present = perClass.filter((value) => value > 0).length;
    const classWeight = Float64Array.from(perClass, (value) =>
      value > 0 ? n / (present * value) : 0,
    );
    const gradient = new Float64Array(size);
    const biasGradient = new Float64Array(classes);
    const z = new Float64Array(classes);
    for (let iteration = 0; iteration < count; iteration++) {
      gradient.fill(0);
      biasGradient.fill(0);
      let total = 0;
      for (let i = 0; i < n; i++) {
        const x = inputs[i] ?? new Float64Array(dims);
        const label = rows[i]?.label ?? 0;
        scores(x, z);
        const sum = softmaxInPlace(z, () => true);
        const weight = classWeight[label] ?? 0;
        total += weight;
        for (let c = 0; c < classes; c++) {
          const error = ((z[c] ?? 0) / sum - (c === label ? 1 : 0)) * weight;
          if (error === 0) continue;
          biasGradient[c] = (biasGradient[c] ?? 0) + error;
          const row = c * dims;
          for (let d = 0; d < dims; d++)
            gradient[row + d] = (gradient[row + d] ?? 0) + error * (x[d] ?? 0);
        }
      }
      if (total === 0) break;
      steps += 1;
      adam(weights, gradient, moment, velocity, total, options.l2);
      adam(bias, biasGradient, biasMoment, biasVelocity, total, 0);
    }
    trainedOn = n;
    return count;
  }

  return {
    dims,
    classes,
    get count() {
      return examples.size;
    },
    get ready() {
      return isReady();
    },
    get trained() {
      return trainedOn > 0;
    },
    teach(key, feature, label) {
      if (feature.length !== dims)
        throw new RangeError(`Expected ${dims} features, got ${feature.length}`);
      if (!Number.isInteger(label) || label < 0 || label >= classes) {
        throw new RangeError(`The class ${label} is outside 0 to ${classes - 1}`);
      }
      examples.delete(key);
      examples.set(key, { key, feature: Float32Array.from(feature), label });
    },
    forget(key) {
      return examples.delete(key);
    },
    train,
    predict(feature) {
      if (trainedOn === 0) return null;
      if (feature.length !== dims)
        throw new RangeError(`Expected ${dims} features, got ${feature.length}`);
      const seen = new Set([...examples.values()].map((example) => example.label));
      const z = new Float64Array(classes);
      scores(standardized(feature), z);
      const allowed = (c: number) => seen.size === 0 || seen.has(c);
      const sum = softmaxInPlace(z, allowed);
      return Float32Array.from(z, (value) => value / sum);
    },
    examples() {
      return [...examples.values()];
    },
  };
}

export function argmax(values: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if ((values[i] ?? 0) > (values[best] ?? 0)) best = i;
  return best;
}
