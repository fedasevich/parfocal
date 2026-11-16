export interface PatchImage {
  readonly rgb: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export type Seed = readonly [number, number];

export interface PromptMask {
  readonly mask: Uint8Array | null;
  readonly score: number;
  readonly stability: number;
  readonly logits?: Float32Array;
}

export type BatchDecoder = (seeds: readonly Seed[]) => Promise<readonly PromptMask[]>;

export type PromptQuality = "fast" | "best";

export interface PromptPassOptions {
  readonly seedRadius: number;
  readonly minArea: number;
  readonly maxArea: number;
  readonly minStability: number;
  readonly maxOverlap: number;
  readonly maxSeeds: number;
  readonly minContrast: number;
  readonly batch: number;
  readonly residual: boolean;
  readonly residualBias: number;
  readonly ensemble: number;
}

export const promptTileOverlapPixels = 96;

export const promptPassDefaults: PromptPassOptions = {
  seedRadius: 14,
  minArea: 30,
  maxArea: 7200,
  minStability: 0.8,
  maxOverlap: 0.3,
  maxSeeds: 600,
  minContrast: 24,
  batch: 16,
  residual: false,
  residualBias: -12,
  ensemble: 0,
};

export const promptEnsemblePoints = 4;

export function promptPassOptionsFor(
  micronsPerPixel: number | null,
  quality: PromptQuality,
): PromptPassOptions {
  const mpp = micronsPerPixel !== null && micronsPerPixel > 0 ? micronsPerPixel : 0.25;
  return {
    ...promptPassDefaults,
    seedRadius: Math.max(3, 3.5 / mpp),
    minArea: Math.max(8, Math.round(Math.PI * (1.2 / mpp) ** 2)),
    maxArea: Math.round(Math.PI * (12 / mpp) ** 2),
    residual: quality === "best",
    ensemble: quality === "best" ? promptEnsemblePoints : 0,
  };
}

export function stabilityScore(logits: Float32Array, offset = 1): number {
  let loose = 0;
  let strict = 0;
  for (const value of logits) {
    if (value > -offset) {
      loose++;
      if (value > offset) strict++;
    }
  }
  return loose === 0 ? 0 : strict / loose;
}

export function darknessMap(image: PatchImage): Uint8Array {
  const out = new Uint8Array(image.width * image.height);
  for (let i = 0; i < out.length; i++) {
    const red = image.rgb[i * 3] ?? 0;
    const green = image.rgb[i * 3 + 1] ?? 0;
    const blue = image.rgb[i * 3 + 2] ?? 0;
    out[i] = 255 - Math.max(red, green, blue);
  }
  return out;
}

export function otsuThreshold(values: Uint8Array): number {
  const bins = new Float64Array(256);
  for (const value of values) bins[value] = (bins[value] ?? 0) + 1;
  const total = values.length;
  let weightedTotal = 0;
  for (let level = 0; level < 256; level++) weightedTotal += level * (bins[level] ?? 0);
  let below = 0;
  let weightedBelow = 0;
  let best = 0;
  let bestVariance = -1;
  for (let level = 0; level < 256; level++) {
    below += bins[level] ?? 0;
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    weightedBelow += level * (bins[level] ?? 0);
    const meanBelow = weightedBelow / below;
    const meanAbove = (weightedTotal - weightedBelow) / above;
    const variance = below * above * (meanBelow - meanAbove) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = level;
    }
  }
  return best;
}

function boxBlur3(values: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          sum += values[ny * width + nx] ?? 0;
          count++;
        }
      }
      out[y * width + x] = Math.round(sum / count);
    }
  }
  return out;
}

function morph(mask: Uint8Array, width: number, height: number, keepWhen: 0 | 1): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = keepWhen === 1 ? 1 : 0;
      for (let ny = y - 1; ny <= y + 1; ny++) {
        for (let nx = x - 1; nx <= x + 1; nx++) {
          const inside = nx >= 0 && ny >= 0 && nx < width && ny < height;
          const pixel = inside ? (mask[ny * width + nx] ?? 0) : 0;
          if (keepWhen === 1 && pixel === 0) value = 0;
          if (keepWhen === 0 && pixel === 1) value = 1;
        }
      }
      out[y * width + x] = value;
    }
  }
  return out;
}

export function openMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  return morph(morph(mask, width, height, 1), width, height, 0);
}

export function chamferDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  const far = width + height;
  const distance = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) distance[i] = mask[i] ? far : 0;
  const diagonal = Math.SQRT2;
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : (distance[y * width + x] ?? 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      distance[i] = Math.min(
        distance[i] ?? far,
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + diagonal,
        at(x + 1, y - 1) + diagonal,
      );
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!mask[i]) continue;
      distance[i] = Math.min(
        distance[i] ?? far,
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + diagonal,
        at(x - 1, y + 1) + diagonal,
      );
    }
  }
  return distance;
}

export function localMaxima(
  distance: Float32Array,
  width: number,
  height: number,
  radius: number,
  minimum: number,
): number[] {
  const order: number[] = [];
  for (let i = 0; i < distance.length; i++) if ((distance[i] ?? 0) >= minimum) order.push(i);
  order.sort((a, b) => (distance[b] ?? 0) - (distance[a] ?? 0) || a - b);
  const taken = new Uint8Array(distance.length);
  const peaks: number[] = [];
  for (const index of order) {
    if (taken[index]) continue;
    peaks.push(index);
    const x = index % width;
    const y = (index - x) / width;
    for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny++) {
      for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx++) {
        taken[ny * width + nx] = 1;
      }
    }
  }
  return peaks;
}

export function stainSeeds(
  image: PatchImage,
  options: PromptPassOptions,
  covered?: Uint8Array,
  thresholdBias = 0,
): Seed[] {
  const { width, height } = image;
  const darkness = darknessMap(image);
  let low = 255;
  let high = 0;
  for (const value of darkness) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  if (high - low < options.minContrast) return [];
  const smoothed = boxBlur3(darkness, width, height);
  const threshold = Math.max(1, Math.min(254, otsuThreshold(smoothed) + thresholdBias));
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    if ((smoothed[i] ?? 0) > threshold && !covered?.[i]) mask[i] = 1;
  }
  const distance = chamferDistance(openMask(mask, width, height), width, height);
  const suppress = Math.max(2, Math.round(options.seedRadius * 0.6));
  const minimum = Math.max(1.5, options.seedRadius * 0.2);
  return localMaxima(distance, width, height, suppress, minimum)
    .slice(0, options.maxSeeds)
    .map((index): Seed => [index % width, Math.floor(index / width)]);
}

export function seedComponent(mask: Uint8Array, width: number, height: number, seed: Seed) {
  const start = seed[1] * width + seed[0];
  if (!mask[start]) return null;
  const component = new Uint8Array(mask.length);
  const stack = [start];
  component[start] = 1;
  let area = 0;
  while (stack.length > 0) {
    const index = stack.pop() ?? 0;
    area++;
    const x = index % width;
    const y = (index - x) / width;
    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];
    for (const next of neighbours) {
      if (next >= 0 && mask[next] && !component[next]) {
        component[next] = 1;
        stack.push(next);
      }
    }
  }
  return { mask: component, area };
}

export interface PromptNucleus {
  readonly mask: Uint8Array;
  readonly area: number;
  readonly seed: Seed;
  readonly score: number;
  readonly stability: number;
  readonly bounds: Bounds;
}

export type Bounds = readonly [number, number, number, number];

export function maskBounds(mask: Uint8Array, width: number): Bounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const x = p % width;
    const y = (p - x) / width;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function boundsMeet(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function maskIoU(a: PromptNucleus, b: PromptNucleus, width: number): number {
  if (!boundsMeet(a.bounds, b.bounds)) return 0;
  const x0 = Math.max(a.bounds[0], b.bounds[0]);
  const y0 = Math.max(a.bounds[1], b.bounds[1]);
  const x1 = Math.min(a.bounds[2], b.bounds[2]);
  const y1 = Math.min(a.bounds[3], b.bounds[3]);
  let both = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = y * width + x;
      if (a.mask[p] && b.mask[p]) both++;
    }
  }
  return both / (a.area + b.area - both);
}

export function ensemblePoints(nucleus: PromptNucleus, width: number, count: number): Seed[] {
  let sumX = 0;
  let sumY = 0;
  for (let p = 0; p < nucleus.mask.length; p++) {
    if (!nucleus.mask[p]) continue;
    sumX += p % width;
    sumY += Math.floor(p / width);
  }
  const cx = sumX / nucleus.area;
  const cy = sumY / nucleus.area;
  const radius = Math.sqrt(nucleus.area / Math.PI) * 0.45;
  const height = nucleus.mask.length / width;
  const points: Seed[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.PI / 4;
    const x = Math.round(cx + Math.cos(angle) * radius);
    const y = Math.round(cy + Math.sin(angle) * radius);
    if (x >= 0 && y >= 0 && x < width && y < height && nucleus.mask[y * width + x]) {
      points.push([x, y]);
    }
  }
  const [sx, sy] = nucleus.seed;
  if (!points.some(([x, y]) => x === sx && y === sy)) points.push(nucleus.seed);
  return points;
}

function confidence(nucleus: PromptNucleus): number {
  return nucleus.score * nucleus.stability;
}

export function dropDuplicates(nuclei: readonly PromptNucleus[], width: number): PromptNucleus[] {
  const ordered = [...nuclei].sort((a, b) => confidence(b) - confidence(a));
  const kept: PromptNucleus[] = [];
  for (const nucleus of ordered) {
    if (kept.some((other) => maskIoU(other, nucleus, width) > 0.5)) continue;
    kept.push(nucleus);
  }
  return kept;
}

export interface PromptPassOutcome {
  readonly nuclei: PromptNucleus[];
  readonly seeds: number;
  readonly decodes: number;
}

export async function promptPass(
  image: PatchImage,
  decode: BatchDecoder,
  options: PromptPassOptions = promptPassDefaults,
  signal?: AbortSignal,
): Promise<PromptPassOutcome> {
  const { width, height } = image;
  const covered = new Uint8Array(width * height);
  const nuclei: PromptNucleus[] = [];
  const chunk = Math.max(1, options.batch);
  let decodes = 0;
  let seedCount = 0;

  const consider = async (seeds: readonly Seed[]) => {
    seedCount += seeds.length;
    for (let start = 0; start < seeds.length; start += chunk) {
      if (signal?.aborted) return;
      const pending = seeds
        .slice(start, start + chunk)
        .filter((seed) => !covered[seed[1] * width + seed[0]]);
      if (pending.length === 0) continue;
      decodes += pending.length;
      const results = await decode(pending);
      pending.forEach((seed, i) => {
        if (covered[seed[1] * width + seed[0]]) return;
        const decoded = results[i];
        if (decoded?.mask == null) return;
        const component = seedComponent(decoded.mask, width, height, seed);
        if (component === null) return;
        if (component.area < options.minArea || component.area > options.maxArea) return;
        if (decoded.stability < options.minStability) return;
        let overlap = 0;
        for (let p = 0; p < component.mask.length; p++) {
          if (component.mask[p] && covered[p]) overlap++;
        }
        if (overlap / component.area > options.maxOverlap) return;
        for (let p = 0; p < component.mask.length; p++) if (component.mask[p]) covered[p] = 1;
        nuclei.push({
          mask: component.mask,
          area: component.area,
          seed,
          score: decoded.score,
          stability: decoded.stability,
          bounds: maskBounds(component.mask, width),
        });
      });
    }
  };

  const refine = async () => {
    const perNucleus = nuclei.map((nucleus) => ensemblePoints(nucleus, width, options.ensemble));
    let cursor = 0;
    while (cursor < nuclei.length) {
      if (signal?.aborted) return;
      const owners: number[] = [];
      const prompts: Seed[] = [];
      while (
        cursor < nuclei.length &&
        (prompts.length === 0 || prompts.length + (perNucleus[cursor]?.length ?? 0) <= chunk)
      ) {
        for (const point of perNucleus[cursor] ?? []) {
          prompts.push(point);
          owners.push(cursor);
        }
        cursor++;
      }
      decodes += prompts.length;
      const results = await decode(prompts);
      const sums = new Map<number, { logits: Float32Array; count: number; score: number }>();
      results.forEach((result, index) => {
        const owner = owners[index];
        if (result.logits === undefined || owner === undefined) return;
        let entry = sums.get(owner);
        if (entry === undefined) {
          entry = { logits: new Float32Array(result.logits.length), count: 0, score: 0 };
          sums.set(owner, entry);
        }
        for (let p = 0; p < result.logits.length; p++) {
          entry.logits[p] = (entry.logits[p] ?? 0) + (result.logits[p] ?? 0);
        }
        entry.count++;
        entry.score += result.score;
      });
      for (const [owner, entry] of sums) {
        const first = nuclei[owner];
        if (first === undefined) continue;
        const mask = new Uint8Array(entry.logits.length);
        for (let p = 0; p < mask.length; p++) {
          entry.logits[p] = (entry.logits[p] ?? 0) / entry.count;
          if ((entry.logits[p] ?? 0) > 0) mask[p] = 1;
        }
        const component = seedComponent(mask, width, height, first.seed);
        if (component === null) continue;
        if (component.area < options.minArea || component.area > options.maxArea) continue;
        const averaged: PromptNucleus = {
          mask: component.mask,
          area: component.area,
          seed: first.seed,
          score: entry.score / entry.count,
          stability: stabilityScore(entry.logits),
          bounds: maskBounds(component.mask, width),
        };
        if (maskIoU(first, averaged, width) < 0.5) continue;
        nuclei[owner] = averaged;
      }
    }
  };

  await consider(stainSeeds(image, options));
  if (options.residual && signal?.aborted !== true) {
    await consider(stainSeeds(image, options, covered, options.residualBias));
  }
  if (options.ensemble > 0 && signal?.aborted !== true) await refine();
  return { nuclei: dropDuplicates(nuclei, width), seeds: seedCount, decodes };
}
