import type { TypedOutline } from "../overlay/outline-modes.ts";
import type { ClassName } from "../overlay/outline-style.ts";
import { type CellChunk, readCellChunk } from "./cell-chunk.ts";
import {
  type CellConfidence,
  confidenceOf,
  isUnsureCell,
  UNCALIBRATED,
} from "./cell-confidence.ts";
import { CellEdits } from "./cell-edits.ts";
import {
  type CellSummary,
  type ChunkEntry,
  numberOfRow,
  type Rect,
  readCellSummary,
  rowOfNumber,
} from "./cell-summary.ts";
import { ChunkCache, DEFAULT_VERTEX_BUDGET } from "./chunk-cache.ts";
import { decodePfc } from "./pfc.ts";

export const PAGED_ABOVE = 200_000;
export const VIEW_PAD = 0.25;
export const FETCH_BATCH = 8;

export interface CellSource {
  summary(signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  chunk(index: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
}

export interface PagedCellsOptions {
  readonly pagedAbove?: number;
  readonly vertexBudget?: number;
  readonly batch?: number;
  readonly pad?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
  readonly onChange?: () => void;
}

export interface ShowReport {
  readonly wanted: number;
  readonly loaded: number;
  readonly evicted: number;
  readonly superseded: boolean;
}

export interface PagedStats {
  readonly cells: number;
  readonly chunks: number;
  readonly paged: boolean;
  readonly residentChunks: number;
  readonly residentCells: number;
  readonly residentVertices: number;
  readonly vertexBudget: number;
  readonly summaryBytes: number;
  readonly residentBytes: number;
  readonly heldBytes: number;
}

export interface LoadedCell {
  readonly number: number;
  readonly classIndex: number;
  readonly removed: boolean;
  readonly score: number;
  readonly flags: number;
  readonly ring: Float32Array;
  readonly probs: Uint8Array | null;
  readonly altClass: number | null;
  readonly confidence: CellConfidence | null;
}

export interface UnsureCell {
  readonly number: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly classIndex: number;
  readonly confidence: CellConfidence | null;
}

export type ClassNameOf = (classIndex: number) => ClassName | null;

const BYTE = 255;

export async function fetchBytes(
  url: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export function httpCellSource(
  summaryUrl: string,
  chunkUrl: (index: number) => string,
  fetcher: typeof fetch = fetch,
): CellSource {
  return {
    summary: (signal) => fetchBytes(summaryUrl, fetcher, signal),
    chunk: (index, signal) => fetchBytes(chunkUrl(index), fetcher, signal),
  };
}

function overlaps(tile: Rect, area: Rect): boolean {
  return tile[0] < area[2] && tile[2] > area[0] && tile[1] < area[3] && tile[3] > area[1];
}

function padded(view: Rect, share: number): Rect {
  const padX = (view[2] - view[0]) * share;
  const padY = (view[3] - view[1]) * share;
  return [view[0] - padX, view[1] - padY, view[2] + padX, view[3] + padY];
}

const EVERYWHERE: Rect = [-Infinity, -Infinity, Infinity, Infinity];

export class PagedCells {
  readonly edits = new CellEdits();
  readonly cache: ChunkCache;
  private readonly pending = new Map<number, Promise<CellChunk>>();
  private readonly aborter = new AbortController();
  private keep: ReadonlySet<number> = new Set();
  private generation = 0;

  readonly summary: CellSummary;
  readonly paged: boolean;
  private readonly source: CellSource;
  private readonly options: PagedCellsOptions;

  private constructor(
    source: CellSource,
    summary: CellSummary,
    paged: boolean,
    options: PagedCellsOptions,
  ) {
    this.source = source;
    this.summary = summary;
    this.paged = paged;
    this.options = options;
    this.cache = new ChunkCache(paged ? (options.vertexBudget ?? DEFAULT_VERTEX_BUDGET) : Infinity);
    options.signal?.addEventListener("abort", () => this.aborter.abort(), { once: true });
  }

  static async open(source: CellSource, options: PagedCellsOptions = {}): Promise<PagedCells> {
    const bytes = await source.summary(options.signal);
    const summary = readCellSummary(await decodePfc(bytes));
    const paged = summary.count > (options.pagedAbove ?? PAGED_ABOVE);
    return new PagedCells(source, summary, paged, options);
  }

  close(): void {
    this.aborter.abort();
    this.cache.clear();
    this.pending.clear();
  }

  async show(view: Rect): Promise<ShowReport> {
    const area = this.paged ? padded(view, this.options.pad ?? VIEW_PAD) : EVERYWHERE;
    const inArea = this.summary.chunks.filter(
      (entry) => entry.count > 0 && overlaps(entry.tile, area),
    );
    this.keep = new Set(inArea.map((entry) => entry.chunk));
    for (const entry of inArea) this.cache.touch(entry.chunk);
    const wanted = inArea
      .filter((entry) => !this.cache.has(entry.chunk))
      .sort((a, b) => distanceToView(a, view) - distanceToView(b, view));
    const generation = ++this.generation;
    const batch = this.options.batch ?? FETCH_BATCH;
    let loaded = 0;
    let evicted = 0;
    for (let start = 0; start < wanted.length; start += batch) {
      if (generation !== this.generation)
        return { wanted: wanted.length, loaded, evicted, superseded: true };
      const group = wanted.slice(start, start + batch);
      await Promise.all(group.map((entry) => this.load(entry.chunk)));
      loaded += group.length;
      evicted += this.cache.evict(this.keep);
      this.options.onChange?.();
    }
    return { wanted: wanted.length, loaded, evicted, superseded: generation !== this.generation };
  }

  async cell(cellNumber: number): Promise<LoadedCell | null> {
    const row = rowOfNumber(this.summary, cellNumber);
    if (row < 0) return null;
    const chunk = await this.load(this.summary.chunk[row] ?? 0);
    const local = this.summary.index[row] ?? 0;
    this.cache.evict(this.keep);
    return this.loadedCell(chunk, local);
  }

  forEachLive(visit: (chunk: CellChunk, local: number, classIndex: number) => void): void {
    for (const chunk of this.cache.chunks()) {
      for (let local = 0; local < chunk.count; local++) {
        const cellNumber = chunk.number[local] ?? 0;
        if (this.edits.isRemoved(cellNumber)) continue;
        visit(chunk, local, this.edits.classOf(cellNumber, chunk.classIndex[local] ?? 0));
      }
    }
  }

  get temperature(): number {
    return this.options.temperature ?? UNCALIBRATED;
  }

  rowConfidence(row: number): CellConfidence | null {
    return confidenceOf(this.summary.probs, row, this.summary.classes, this.temperature);
  }

  unsureIn(view: Rect, limit = Infinity): UnsureCell[] {
    const { summary } = this;
    const found: UnsureCell[] = [];
    for (let row = 0; row < summary.count; row++) {
      const x = summary.x[row] ?? 0;
      const y = summary.y[row] ?? 0;
      if (x < view[0] || x >= view[2] || y < view[1] || y >= view[3]) continue;
      if (!this.rowIsLive(row)) continue;
      const confidence = this.rowConfidence(row);
      if (!isUnsureCell(confidence, summary.flags[row] ?? 0)) continue;
      found.push({
        number: numberOfRow(summary, row),
        row,
        x,
        y,
        classIndex: this.rowClass(row),
        confidence,
      });
    }
    found.sort(
      (a, b) => (a.confidence?.top ?? 0) - (b.confidence?.top ?? 0) || a.number - b.number,
    );
    return found.slice(0, limit);
  }

  outlines(classNameOf: ClassNameOf): TypedOutline[] {
    const classes = this.summary.classes;
    const outlines: TypedOutline[] = [];
    this.forEachLive((chunk, local, classIndex) => {
      const className = classNameOf(classIndex);
      if (className === null) return;
      const confidence = confidenceOf(chunk.probs, local, classes, this.temperature);
      const from = (chunk.offsets[local] ?? 0) * 2;
      const to = (chunk.offsets[local + 1] ?? 0) * 2;
      outlines.push({
        ring: chunk.points.subarray(from, to),
        className,
        top: confidence?.top ?? (chunk.score[local] ?? BYTE) / BYTE,
        second: confidence?.second ?? 0,
      });
    });
    return outlines;
  }

  rowIsLive(row: number): boolean {
    return !this.edits.isRemoved(numberOfRow(this.summary, row));
  }

  rowClass(row: number): number {
    return this.edits.classOf(numberOfRow(this.summary, row), this.summary.classIndex[row] ?? 0);
  }

  liveCount(): number {
    return this.summary.count - this.edits.removedCount;
  }

  stats(): PagedStats {
    let residentCells = 0;
    for (const chunk of this.cache.chunks()) residentCells += chunk.count;
    return {
      cells: this.summary.count,
      chunks: this.summary.chunks.length,
      paged: this.paged,
      residentChunks: this.cache.size,
      residentCells,
      residentVertices: this.cache.vertices,
      vertexBudget: this.cache.vertexBudget,
      summaryBytes: this.summary.byteLength,
      residentBytes: this.cache.bytes,
      heldBytes: this.summary.byteLength + this.cache.bytes,
    };
  }

  private loadedCell(chunk: CellChunk, local: number): LoadedCell {
    const cellNumber = chunk.number[local] ?? 0;
    const from = (chunk.offsets[local] ?? 0) * 2;
    const to = (chunk.offsets[local + 1] ?? 0) * 2;
    return {
      number: cellNumber,
      classIndex: this.edits.classOf(cellNumber, chunk.classIndex[local] ?? 0),
      removed: this.edits.isRemoved(cellNumber),
      score: chunk.score[local] ?? 0,
      flags: chunk.flags[local] ?? 0,
      ring: chunk.points.subarray(from, to),
      probs: probsOf(chunk, local, this.summary.classes),
      altClass: chunk.altClass?.[local] ?? null,
      confidence: confidenceOf(chunk.probs, local, this.summary.classes, this.temperature),
    };
  }

  private load(index: number): Promise<CellChunk> {
    const resident = this.cache.get(index);
    if (resident) return Promise.resolve(resident);
    const inFlight = this.pending.get(index);
    if (inFlight) return inFlight;
    const started = this.fetchChunk(index).finally(() => this.pending.delete(index));
    this.pending.set(index, started);
    return started;
  }

  private async fetchChunk(index: number): Promise<CellChunk> {
    const bytes = await this.source.chunk(index, this.aborter.signal);
    const chunk = readCellChunk(await decodePfc(bytes), index);
    this.cache.put(chunk);
    return chunk;
  }
}

function probsOf(chunk: CellChunk, local: number, classes: number): Uint8Array | null {
  if (chunk.probs === null || classes < 1) return null;
  return chunk.probs.subarray(local * classes, (local + 1) * classes);
}

function distanceToView(entry: ChunkEntry, view: Rect): number {
  const tileX = (entry.tile[0] + entry.tile[2]) / 2;
  const tileY = (entry.tile[1] + entry.tile[3]) / 2;
  return Math.hypot(tileX - (view[0] + view[2]) / 2, tileY - (view[1] + view[3]) / 2);
}
