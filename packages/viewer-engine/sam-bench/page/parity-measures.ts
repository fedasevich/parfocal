export function maxAbsDifference(expected: Float32Array, got: Float32Array): number {
  if (expected.length !== got.length) {
    throw new Error(`Compared ${expected.length} values with ${got.length}`);
  }
  let largest = 0;
  for (let index = 0; index < expected.length; index++) {
    largest = Math.max(largest, Math.abs((expected[index] ?? 0) - (got[index] ?? 0)));
  }
  return largest;
}

export function maskIou(
  expected: Uint8Array,
  got: Float32Array,
  gotOffset: number,
  threshold: number,
): number {
  let both = 0;
  let either = 0;
  for (let index = 0; index < expected.length; index++) {
    const a = expected[index] === 1;
    const b = (got[gotOffset + index] ?? 0) > threshold;
    if (a && b) both++;
    if (a || b) either++;
  }
  return either === 0 ? 1 : both / either;
}

export function planeIou(
  expected: Float32Array,
  got: Float32Array,
  plane: number,
  threshold: number,
): number {
  let both = 0;
  let either = 0;
  for (let index = 0; index < plane; index++) {
    const a = (expected[index] ?? 0) > threshold;
    const b = (got[index] ?? 0) > threshold;
    if (a && b) both++;
    if (a || b) either++;
  }
  return either === 0 ? 1 : both / either;
}

export function bestMultimask(scores: Float32Array): number {
  let best = 1;
  for (let index = 2; index < scores.length; index++) {
    if ((scores[index] ?? -Infinity) > (scores[best] ?? -Infinity)) best = index;
  }
  return best;
}

export function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
