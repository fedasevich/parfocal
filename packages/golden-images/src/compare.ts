import { createFrame, type Frame, type Rgb } from "#frame.ts";

export interface Tolerance {
  readonly maxChannelDelta: number;
  readonly maxDifferingFraction: number;
  readonly maxMeanChannelError: number;
}

export interface Comparison {
  readonly pass: boolean;
  readonly differingPixels: number;
  readonly differingFraction: number;
  readonly maxDelta: Rgb;
  readonly meanError: Rgb;
  readonly failures: readonly string[];
  readonly channelHint: string | null;
}

export const EXACT: Tolerance = {
  maxChannelDelta: 0,
  maxDifferingFraction: 0,
  maxMeanChannelError: 0,
};

const CHANNEL_NAMES = ["R", "G", "B"] as const;

const PERMUTATIONS: readonly (readonly [number, number, number])[] = [
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function channelAt(data: Uint8Array, index: number): number {
  return data[index] ?? 0;
}

function meanErrorWithOrder(
  actual: Frame,
  expected: Frame,
  order: readonly [number, number, number],
): number {
  let total = 0;
  for (let offset = 0; offset < actual.data.length; offset += 4) {
    for (let channel = 0; channel < 3; channel++) {
      total += Math.abs(
        channelAt(actual.data, offset + channel) -
          channelAt(expected.data, offset + (order[channel] ?? channel)),
      );
    }
  }
  return total / ((actual.data.length / 4) * 3);
}

function describeOrder(order: readonly [number, number, number]): string {
  return order.map((source) => CHANNEL_NAMES[source] ?? "?").join("");
}

function channelPermutationHint(
  actual: Frame,
  expected: Frame,
  straightError: number,
): string | null {
  if (straightError < 1) {
    return null;
  }
  let best: { order: readonly [number, number, number]; error: number } | null = null;
  for (const order of PERMUTATIONS) {
    const error = meanErrorWithOrder(actual, expected, order);
    if (!best || error < best.error) {
      best = { order, error };
    }
  }
  if (!best || best.error > straightError / 4) {
    return null;
  }
  return `The frame matches the golden read in ${describeOrder(best.order)} order (mean error ${best.error.toFixed(2)} against ${straightError.toFixed(2)}), so the renderer probably swaps colour channels`;
}

export function compareFrames(actual: Frame, expected: Frame, tolerance: Tolerance): Comparison {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      pass: false,
      differingPixels: actual.width * actual.height,
      differingFraction: 1,
      maxDelta: [255, 255, 255],
      meanError: [255, 255, 255],
      failures: [
        `Size ${actual.width}x${actual.height} does not match the golden ${expected.width}x${expected.height}`,
      ],
      channelHint: null,
    };
  }
  const pixels = actual.width * actual.height;
  const maxDelta = [0, 0, 0];
  const totals = [0, 0, 0];
  let differingPixels = 0;
  for (let offset = 0; offset < actual.data.length; offset += 4) {
    let differs = false;
    for (let channel = 0; channel < 3; channel++) {
      const delta = Math.abs(
        channelAt(actual.data, offset + channel) - channelAt(expected.data, offset + channel),
      );
      totals[channel] = (totals[channel] ?? 0) + delta;
      if (delta > (maxDelta[channel] ?? 0)) {
        maxDelta[channel] = delta;
      }
      if (delta > tolerance.maxChannelDelta) {
        differs = true;
      }
    }
    if (differs) {
      differingPixels++;
    }
  }
  const meanError: Rgb = [
    (totals[0] ?? 0) / pixels,
    (totals[1] ?? 0) / pixels,
    (totals[2] ?? 0) / pixels,
  ];
  const differingFraction = differingPixels / pixels;
  const failures: string[] = [];
  if (differingFraction > tolerance.maxDifferingFraction) {
    failures.push(
      `${differingPixels} pixels (${(differingFraction * 100).toFixed(3)}%) differ by more than ${tolerance.maxChannelDelta} in a channel, the limit is ${(tolerance.maxDifferingFraction * 100).toFixed(3)}%`,
    );
  }
  meanError.forEach((error, channel) => {
    if (error > tolerance.maxMeanChannelError) {
      failures.push(
        `Mean ${CHANNEL_NAMES[channel] ?? "?"} error ${error.toFixed(3)} exceeds ${tolerance.maxMeanChannelError}`,
      );
    }
  });
  const straightError = (meanError[0] + meanError[1] + meanError[2]) / 3;
  return {
    pass: failures.length === 0,
    differingPixels,
    differingFraction,
    maxDelta: [maxDelta[0] ?? 0, maxDelta[1] ?? 0, maxDelta[2] ?? 0],
    meanError,
    failures,
    channelHint:
      failures.length === 0 ? null : channelPermutationHint(actual, expected, straightError),
  };
}

export function describeComparison(comparison: Comparison): string {
  const lines = [
    `max delta R ${comparison.maxDelta[0]} G ${comparison.maxDelta[1]} B ${comparison.maxDelta[2]}`,
    `mean error R ${comparison.meanError[0].toFixed(3)} G ${comparison.meanError[1].toFixed(3)} B ${comparison.meanError[2].toFixed(3)}`,
    ...comparison.failures,
  ];
  if (comparison.channelHint) {
    lines.push(comparison.channelHint);
  }
  return lines.join("\n");
}

export function diffFrame(actual: Frame, expected: Frame, tolerance: Tolerance): Frame {
  const width = Math.min(actual.width, expected.width);
  const height = Math.min(actual.height, expected.height);
  const diff = createFrame(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = (y * actual.width + x) * 4;
      const e = (y * expected.width + x) * 4;
      const d = (y * width + x) * 4;
      let worst = 0;
      for (let channel = 0; channel < 3; channel++) {
        worst = Math.max(
          worst,
          Math.abs(channelAt(actual.data, a + channel) - channelAt(expected.data, e + channel)),
        );
      }
      if (worst > tolerance.maxChannelDelta) {
        diff.data.set([255, 0, 255, 255], d);
      } else {
        const luma =
          0.299 * channelAt(expected.data, e) +
          0.587 * channelAt(expected.data, e + 1) +
          0.114 * channelAt(expected.data, e + 2);
        const faded = Math.round(192 + luma / 4);
        diff.data.set([faded, faded, faded, 255], d);
      }
    }
  }
  return diff;
}
