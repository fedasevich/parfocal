import type {
  MicronsPerPixel,
  Photometric,
  PixelDtype,
  PixelLevel,
  PixelSource,
  PixelWindow,
} from "../pixel-source/types.ts";

export const patchMarginShare = 1 / 8;

export const defaultPatchCacheSize = 8;

export interface PatchSource
  extends Pick<PixelSource, "levels" | "photometric" | "dtype" | "getRaster"> {
  readonly micronsPerPixel: MicronsPerPixel | null;
}

export interface PatchSourceInfo {
  readonly levels: readonly PixelLevel[];
  readonly micronsPerPixel: MicronsPerPixel | null;
  readonly photometric: Photometric;
  readonly dtype: PixelDtype;
}

export interface PatchQuery {
  readonly level: number;
  readonly size: number;
  readonly x: number;
  readonly y: number;
}

export interface Patch {
  readonly key: string;
  readonly level: number;
  readonly downsample: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly absent: boolean;
  readonly rgb: Uint8Array<ArrayBuffer> | null;
}

export interface PatchRead {
  readonly patch: Patch;
  readonly cacheHit: boolean;
  readonly moved: boolean;
}

export interface PatchCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly reads: number;
  readonly size: number;
}

export interface PatchReader {
  readonly ready: Promise<PatchSourceInfo>;
  read(query: PatchQuery, signal?: AbortSignal): Promise<PatchRead>;
  stats(): PatchCacheStats;
  close(): void;
}

export class UnsupportedPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPatchError";
  }
}

export class PatchReaderClosedError extends Error {
  constructor() {
    super("The patch reader is closed");
    this.name = "PatchReaderClosedError";
  }
}

export function patchInfo(source: PatchSource): PatchSourceInfo {
  return {
    levels: source.levels.map(({ downsample, width, height, tileWidth, tileHeight }) => ({
      downsample,
      width,
      height,
      tileWidth,
      tileHeight,
    })),
    micronsPerPixel: source.micronsPerPixel && {
      x: source.micronsPerPixel.x,
      y: source.micronsPerPixel.y,
    },
    photometric: source.photometric,
    dtype: source.dtype,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

interface PatchWindow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function locatePatch(level: PixelLevel, query: PatchQuery): PatchWindow {
  const width = Math.max(1, Math.min(query.size, level.width));
  const height = Math.max(1, Math.min(query.size, level.height));
  const centreX = Math.round(query.x / level.downsample);
  const centreY = Math.round(query.y / level.downsample);
  return {
    width,
    height,
    x: clamp(centreX - Math.floor(width / 2), 0, level.width - width),
    y: clamp(centreY - Math.floor(height / 2), 0, level.height - height),
  };
}

export function patchHoldsPoint(
  patch: Pick<Patch, "x" | "y" | "width" | "height" | "downsample">,
  level: Pick<PixelLevel, "width" | "height">,
  x: number,
  y: number,
  marginShare: number = patchMarginShare,
): boolean {
  const margin = Math.min(patch.width, patch.height) * marginShare;
  const px = clamp(x / patch.downsample, 0, level.width);
  const py = clamp(y / patch.downsample, 0, level.height);
  const left = patch.x === 0 ? 0 : margin;
  const top = patch.y === 0 ? 0 : margin;
  const right = patch.x + patch.width >= level.width ? 0 : margin;
  const bottom = patch.y + patch.height >= level.height ? 0 : margin;
  return (
    px >= patch.x + left &&
    py >= patch.y + top &&
    px <= patch.x + patch.width - right &&
    py <= patch.y + patch.height - bottom
  );
}

export function planesToRgb(
  planes: readonly ArrayLike<number>[],
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const count = width * height;
  const red = planes[0];
  const green = planes[1] ?? red;
  const blue = planes[2] ?? red;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new UnsupportedPatchError("The slide returned no pixel planes");
  }
  const out = new Uint8Array(count * 3);
  for (let index = 0; index < count; index++) {
    out[index * 3] = red[index] ?? 0;
    out[index * 3 + 1] = green[index] ?? 0;
    out[index * 3 + 2] = blue[index] ?? 0;
  }
  return out;
}

export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

interface SharedRead {
  readonly patch: Promise<Patch>;
  readonly stop: AbortController;
  waiting: number;
}

export function createPatchReader(
  source: PatchSource,
  options: { readonly cacheSize?: number } = {},
): PatchReader {
  if (source.dtype !== "uint8") {
    throw new UnsupportedPatchError(`The patch reader reads 8-bit slides, not ${source.dtype}`);
  }
  const cacheSize = Math.max(1, options.cacheSize ?? defaultPatchCacheSize);
  const cache = new Map<string, Patch>();
  const inFlight = new Map<string, SharedRead>();
  const anchors = new Map<string, Patch>();
  let hits = 0;
  let misses = 0;
  let reads = 0;
  let closed = false;

  function remember(patch: Patch): void {
    cache.delete(patch.key);
    cache.set(patch.key, patch);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next();
      if (oldest.done === true) break;
      cache.delete(oldest.value);
    }
  }

  async function fetchPatch(
    key: string,
    level: number,
    window: PatchWindow,
    signal: AbortSignal,
  ): Promise<Patch> {
    const info = source.levels[level] as PixelLevel;
    const frame: PixelWindow = [
      window.x,
      window.y,
      window.x + window.width,
      window.y + window.height,
    ];
    const raster = await source.getRaster({ level, window: frame, signal });
    reads += 1;
    const base = { key, level, downsample: info.downsample, ...window };
    if (raster.absent) return { ...base, absent: true, rgb: null };
    return { ...base, absent: false, rgb: planesToRgb(raster.planes, window.width, window.height) };
  }

  function shared(key: string, level: number, window: PatchWindow): SharedRead {
    const running = inFlight.get(key);
    if (running !== undefined) return running;
    const stop = new AbortController();
    const started: SharedRead = {
      stop,
      waiting: 0,
      patch: fetchPatch(key, level, window, stop.signal).finally(() => {
        if (inFlight.get(key) === started) inFlight.delete(key);
      }),
    };
    inFlight.set(key, started);
    return started;
  }

  function joined(key: string, running: SharedRead, signal?: AbortSignal): Promise<Patch> {
    running.waiting += 1;
    if (signal === undefined) return running.patch;
    return new Promise((resolve, reject) => {
      const leave = () => {
        running.waiting -= 1;
        if (running.waiting === 0) {
          if (inFlight.get(key) === running) inFlight.delete(key);
          running.stop.abort(abortError(signal));
        }
        reject(abortError(signal));
      };
      signal.addEventListener("abort", leave, { once: true });
      running.patch.then(resolve, reject).finally(() => signal.removeEventListener("abort", leave));
    });
  }

  async function read(query: PatchQuery, signal?: AbortSignal): Promise<PatchRead> {
    if (closed) throw new PatchReaderClosedError();
    if (signal?.aborted) throw abortError(signal);
    const info = source.levels[query.level];
    if (info === undefined) throw new RangeError(`The slide has no level ${query.level}`);
    const anchorKey = `${query.level}|${query.size}`;
    const anchor = anchors.get(anchorKey);
    if (anchor !== undefined && patchHoldsPoint(anchor, info, query.x, query.y)) {
      hits += 1;
      remember(anchor);
      return { patch: anchor, cacheHit: true, moved: false };
    }
    const window = locatePatch(info, query);
    const key = `${query.level}|${window.x}|${window.y}|${window.width}|${window.height}`;
    const cached = cache.get(key);
    let patch: Patch;
    let cacheHit = false;
    if (cached !== undefined) {
      hits += 1;
      cacheHit = true;
      patch = cached;
      remember(cached);
    } else {
      misses += 1;
      patch = await joined(key, shared(key, query.level, window), signal);
      if (closed) throw new PatchReaderClosedError();
      remember(patch);
    }
    anchors.set(anchorKey, patch);
    return { patch, cacheHit, moved: anchor !== undefined && anchor.key !== patch.key };
  }

  return {
    ready: Promise.resolve(patchInfo(source)),
    read,
    stats: () => ({ hits, misses, reads, size: cache.size }),
    close() {
      closed = true;
      cache.clear();
      anchors.clear();
    },
  };
}
