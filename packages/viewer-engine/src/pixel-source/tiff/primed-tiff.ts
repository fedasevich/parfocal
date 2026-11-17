import { GeoTIFF } from "geotiff";
import { locatesEveryDirectory } from "../tile-index.ts";
import type { SlideIndex, SlideIndexPage, TagValueRange } from "../types.ts";

export const TILE_OFFSETS_TAG = 324;
export const PRIMED_TILE_OFFSETS_LIMIT = 64 * 1024;

interface Slice {
  readonly offset: number;
  readonly length: number;
}

interface Held {
  readonly offset: number;
  readonly end: number;
  readonly data: Promise<ArrayBuffer | null>;
}

interface PrimedPage extends SlideIndexPage {
  readonly ifdOffset: number;
  readonly ifdBytes: number;
  readonly valueRanges: readonly TagValueRange[];
}

export class SlideRangeError extends Error {
  readonly status: number;

  constructor(url: string, status: number) {
    super(`Reading a range of ${url} answered ${status}`);
    this.name = "SlideRangeError";
    this.status = status;
  }
}

function rangeInit(slice: Slice, signal?: AbortSignal): RequestInit {
  const headers = { Range: `bytes=${slice.offset}-${slice.offset + slice.length - 1}` };
  return signal === undefined ? { headers } : { headers, signal };
}

export class PrimedRangeSource {
  readonly #url: string;
  readonly #fetcher: typeof globalThis.fetch;
  readonly #held: readonly Held[];

  constructor(
    url: string,
    fetcher: typeof globalThis.fetch,
    primed: readonly Slice[],
    signal?: AbortSignal,
  ) {
    this.#url = url;
    this.#fetcher = fetcher;
    this.#held = mergedSlices(primed).map((slice) => ({
      offset: slice.offset,
      end: slice.offset + slice.length,
      data: this.#network(slice, signal).catch(() => null),
    }));
  }

  fetch(slices: readonly Slice[], signal?: AbortSignal): Promise<ArrayBuffer[]> {
    return Promise.all(slices.map((slice) => this.#slice(slice, signal)));
  }

  async fetchSlice(slice: Slice, signal?: AbortSignal): Promise<Slice & { data: ArrayBuffer }> {
    return { ...slice, data: await this.#slice(slice, signal) };
  }

  get fileSize(): number | null {
    return null;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  async #slice(slice: Slice, signal?: AbortSignal): Promise<ArrayBuffer> {
    const held = this.#held.find(({ offset, end }) => offset <= slice.offset && slice.offset < end);
    const data = held === undefined ? null : await held.data;
    if (held === undefined || data === null) return this.#network(slice, signal);
    const heldEnd = held.offset + data.byteLength;
    const wanted = slice.offset + slice.length;
    const reachedFileEnd = heldEnd < held.end;
    if (wanted > heldEnd && !reachedFileEnd) return this.#network(slice, signal);
    return data.slice(slice.offset - held.offset, Math.min(wanted, heldEnd) - held.offset);
  }

  async #network(slice: Slice, signal?: AbortSignal): Promise<ArrayBuffer> {
    const response = await this.#fetcher(this.#url, rangeInit(slice, signal));
    if (response.status !== 206) throw new SlideRangeError(this.#url, response.status);
    return response.arrayBuffer();
  }
}

export function mergedSlices(slices: readonly Slice[]): Slice[] {
  const sorted = [...slices].sort((a, b) => a.offset - b.offset);
  const merged: { offset: number; end: number }[] = [];
  for (const { offset, length } of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && offset <= last.end) last.end = Math.max(last.end, offset + length);
    else merged.push({ offset, end: offset + length });
  }
  return merged.map(({ offset, end }) => ({ offset, length: end - offset }));
}

function isPrimedPage(page: SlideIndexPage): page is PrimedPage {
  return (
    page.ifdOffset !== undefined && page.ifdBytes !== undefined && page.valueRanges !== undefined
  );
}

function primedPages(index: SlideIndex | undefined): PrimedPage[] | null {
  const levels = index?.levels;
  if (levels === undefined || !locatesEveryDirectory(levels)) return null;
  const pages = levels.flatMap((level) => [
    { ...level, page: level.page ?? 0 },
    ...(level.siblings ?? []),
  ]);
  return pages.every(isPrimedPage) ? pages : null;
}

export function primedSlices(pages: readonly PrimedPage[], bigTiff: boolean): Slice[] {
  const parserSlice = bigTiff ? 4048 : 1024;
  return pages.flatMap((page) => [
    { offset: page.ifdOffset, length: Math.max(parserSlice, 2 * page.ifdBytes) },
    ...page.valueRanges
      .filter(([tag, , length]) => tag !== TILE_OFFSETS_TAG || length <= PRIMED_TILE_OFFSETS_LIMIT)
      .map(([, offset, length]) => ({ offset, length })),
  ]);
}

export function primedTiff(
  url: URL,
  index: SlideIndex | undefined,
  fetcher: typeof globalThis.fetch | undefined,
  signal?: AbortSignal,
): GeoTIFF | null {
  const pages = primedPages(index);
  const littleEndian = index?.littleEndian;
  const bigTiff = index?.bigTiff;
  const [first] = pages ?? [];
  if (fetcher === undefined || first === undefined) return null;
  if (littleEndian === undefined || bigTiff === undefined) return null;
  const source = new PrimedRangeSource(
    url.href,
    fetcher,
    primedSlices(pages ?? [], bigTiff),
    signal,
  );
  const tiff = new GeoTIFF(source, littleEndian, bigTiff, first.ifdOffset);
  if (!littleEndian) tiff.parser.eager = true;
  return tiff;
}
