import type { Frame } from "#frame.ts";

export interface ContentStats {
  readonly distinctColours: number;
  readonly dominantColourFraction: number;
  readonly lumaStdDev: number;
  readonly transparentFraction: number;
}

export interface ContentMinimums {
  readonly minDistinctColours: number;
  readonly maxDominantColourFraction: number;
  readonly minLumaStdDev: number;
}

export const DEFAULT_CONTENT_MINIMUMS: ContentMinimums = {
  minDistinctColours: 16,
  maxDominantColourFraction: 0.98,
  minLumaStdDev: 2,
};

export class EmptyFrameError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[], stats: ContentStats) {
    super(
      `The frame looks empty: ${problems.join(", ")} (${stats.distinctColours} colours, ${(stats.dominantColourFraction * 100).toFixed(1)}% one colour, luma std dev ${stats.lumaStdDev.toFixed(2)})`,
    );
    this.name = "EmptyFrameError";
    this.problems = problems;
  }
}

export function contentStats(frame: Frame): ContentStats {
  const counts = new Map<number, number>();
  const pixels = frame.width * frame.height;
  let transparent = 0;
  let lumaSum = 0;
  let lumaSquares = 0;
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    const r = frame.data[offset] ?? 0;
    const g = frame.data[offset + 1] ?? 0;
    const b = frame.data[offset + 2] ?? 0;
    const a = frame.data[offset + 3] ?? 0;
    if (a === 0) {
      transparent++;
    }
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    lumaSum += luma;
    lumaSquares += luma * luma;
  }
  const mean = lumaSum / pixels;
  let dominant = 0;
  for (const count of counts.values()) {
    dominant = Math.max(dominant, count);
  }
  return {
    distinctColours: counts.size,
    dominantColourFraction: dominant / pixels,
    lumaStdDev: Math.sqrt(Math.max(0, lumaSquares / pixels - mean * mean)),
    transparentFraction: transparent / pixels,
  };
}

export function contentProblems(
  frame: Frame,
  minimums: ContentMinimums = DEFAULT_CONTENT_MINIMUMS,
): string[] {
  const stats = contentStats(frame);
  const problems: string[] = [];
  if (stats.transparentFraction === 1) {
    problems.push("every pixel is transparent");
  }
  if (stats.distinctColours < minimums.minDistinctColours) {
    problems.push(`fewer than ${minimums.minDistinctColours} distinct colours`);
  }
  if (stats.dominantColourFraction > minimums.maxDominantColourFraction) {
    problems.push(
      `more than ${(minimums.maxDominantColourFraction * 100).toFixed(1)}% of pixels share one colour`,
    );
  }
  if (stats.lumaStdDev < minimums.minLumaStdDev) {
    problems.push(`luma standard deviation below ${minimums.minLumaStdDev}`);
  }
  return problems;
}

export function assertFrameHasContent(
  frame: Frame,
  minimums: ContentMinimums = DEFAULT_CONTENT_MINIMUMS,
): void {
  const problems = contentProblems(frame, minimums);
  if (problems.length > 0) {
    throw new EmptyFrameError(problems, contentStats(frame));
  }
}
