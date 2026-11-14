import type { PolygonBatch, Rgba } from "../overlay/batch-types.ts";
import { type PolygonInput, polygonBatchFromRings } from "../overlay/batches.ts";
import { type CellChunk, readCellChunk } from "./cell-chunk.ts";
import type { Rect } from "./cell-summary.ts";
import { fetchBytes } from "./paged-cells.ts";
import { decodePfc } from "./pfc.ts";
import { RebuildGate } from "./rebuild-gate.ts";
import type { Lineage, SceneBlock, StreamedScene } from "./streamed-scene.ts";

export const POLL_MS = 1000;
export const APPEND_SLICE = 1000;

export const runStatuses = [
  "queued",
  "running",
  "paused",
  "cancelling",
  "cancelled",
  "done",
  "failed",
] as const;

export type RunStatus = (typeof runStatuses)[number];

export const endedStatuses: ReadonlySet<RunStatus> = new Set(["cancelled", "done", "failed"]);

export interface StreamArea {
  readonly seq: number;
  readonly stage: string;
  readonly unit: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly objects: number;
  readonly doneAt: number;
}

export interface StreamPage {
  readonly status: RunStatus;
  readonly areas: readonly StreamArea[];
  readonly after: number;
  readonly more: boolean;
  readonly total: number | null;
}

export interface RunStreamSource {
  page(after: number, signal: AbortSignal): Promise<StreamPage>;
  objects(area: StreamArea, signal: AbortSignal): Promise<readonly PolygonInput[]>;
  cancel(): Promise<void>;
}

export interface RunProgress {
  readonly lineage: Lineage;
  readonly status: RunStatus;
  readonly cancelRequested: boolean;
  readonly done: number;
  readonly total: number | null;
  readonly objects: number;
  readonly share: number | null;
  readonly remainingMs: number | null;
  readonly tiles: readonly Rect[];
  readonly cursor: number;
  readonly rebuilds: number;
}

export interface RunStreamOptions {
  readonly lineage: Lineage;
  readonly scene: StreamedScene;
  readonly source: RunStreamSource;
  readonly after?: number;
  readonly pollMs?: number;
  readonly slice?: number;
  readonly gate?: RebuildGate;
  readonly signal?: AbortSignal;
  readonly onRebuild?: (blocks: readonly SceneBlock[]) => void;
  readonly onProgress?: (progress: RunProgress) => void;
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly yieldTask?: () => Promise<void>;
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function estimateRemainingMs(
  firstDoneAt: number,
  lastDoneAt: number,
  seen: number,
  done: number,
  total: number | null,
): number | null {
  if (total === null || seen < 2 || lastDoneAt <= firstDoneAt) return null;
  const perArea = (lastDoneAt - firstDoneAt) / (seen - 1);
  return Math.max(0, total - done) * perArea;
}

export function areaRect(area: StreamArea): Rect {
  return [area.x, area.y, area.x + area.width, area.y + area.height];
}

export function finishedTileMarks(tiles: readonly Rect[], color: Rgba): PolygonBatch {
  return polygonBatchFromRings(
    tiles.map(([left, top, right, bottom]) => ({
      ring: [left, top, right, top, right, bottom, left, bottom],
      color,
    })),
  );
}

export function chunkPolygons(
  chunk: CellChunk,
  colorOf: (classIndex: number, local: number) => Rgba,
): PolygonInput[] {
  const polygons: PolygonInput[] = [];
  for (let local = 0; local < chunk.count; local++) {
    const from = (chunk.offsets[local] ?? 0) * 2;
    const to = (chunk.offsets[local + 1] ?? 0) * 2;
    polygons.push({
      ring: chunk.points.subarray(from, to),
      color: colorOf(chunk.classIndex[local] ?? 0, local),
    });
  }
  return polygons;
}

export class RunStream {
  private readonly options: RunStreamOptions;
  private readonly gate: RebuildGate;
  private readonly aborter = new AbortController();
  private readonly tiles = new Map<number, Rect>();
  private status: RunStatus = "queued";
  private total: number | null = null;
  private cursor: number;
  private cancelRequested = false;
  private wake: AbortController = new AbortController();
  private firstDoneAt = 0;
  private lastDoneAt = 0;
  private seen = 0;
  private running: Promise<RunProgress> | null = null;

  constructor(options: RunStreamOptions) {
    this.options = options;
    this.gate = options.gate ?? new RebuildGate();
    this.cursor = options.after ?? 0;
    options.signal?.addEventListener("abort", () => this.close(), { once: true });
  }

  start(): Promise<RunProgress> {
    this.running ??= this.loop();
    return this.running;
  }

  async cancel(): Promise<void> {
    if (this.cancelRequested || endedStatuses.has(this.status)) return;
    this.cancelRequested = true;
    this.report();
    await this.options.source.cancel();
    this.wake.abort();
  }

  close(): void {
    this.aborter.abort();
    this.wake.abort();
  }

  progress(): RunProgress {
    const { lineage, scene } = this.options;
    const done = this.tiles.size;
    return {
      lineage,
      status: this.status,
      cancelRequested: this.cancelRequested,
      done,
      total: this.total,
      objects: scene.polygons(lineage),
      share: this.total === null || this.total === 0 ? null : Math.min(1, done / this.total),
      remainingMs: endedStatuses.has(this.status)
        ? 0
        : estimateRemainingMs(this.firstDoneAt, this.lastDoneAt, this.seen, done, this.total),
      tiles: [...this.tiles.values()],
      cursor: this.cursor,
      rebuilds: this.gate.rebuilds,
    };
  }

  private async loop(): Promise<RunProgress> {
    const { source } = this.options;
    const signal = this.aborter.signal;
    while (!signal.aborted) {
      const page = await source.page(this.cursor, signal).catch((error: unknown) => {
        if (signal.aborted) return null;
        throw error;
      });
      if (page === null || signal.aborted) break;
      this.status = page.status;
      if (page.total !== null) this.total = page.total;
      for (const area of page.areas) {
        await this.take(area, signal);
        if (signal.aborted) break;
      }
      this.cursor = page.after;
      this.rebuildIfDue();
      this.report();
      if (page.more) continue;
      if (endedStatuses.has(page.status)) break;
      await (this.options.wait ?? waitFor)(this.options.pollMs ?? POLL_MS, this.wake.signal);
      if (this.wake.signal.aborted && !signal.aborted) this.wake = new AbortController();
    }
    if (this.options.scene.dirtyBlocks() > 0) this.rebuild();
    this.report();
    return this.progress();
  }

  private async take(area: StreamArea, signal: AbortSignal): Promise<void> {
    const { lineage, scene, source } = this.options;
    const yieldTask = this.options.yieldTask ?? nextTask;
    const held = scene.seqOf(lineage, area.unit);
    if (held === undefined || held < area.seq) {
      const polygons =
        area.objects > 0
          ? await source.objects(area, signal).catch((error: unknown) => {
              if (signal.aborted) return [];
              throw error;
            })
          : [];
      if (signal.aborted) return;
      const slice = this.options.slice ?? APPEND_SLICE;
      scene.append(lineage, area.unit, polygons.slice(0, slice), 0, area.seq);
      for (let start = slice, part = 1; start < polygons.length; start += slice, part++) {
        await yieldTask();
        if (signal.aborted) return;
        scene.append(lineage, area.unit, polygons.slice(start, start + slice), part, area.seq);
      }
    }
    this.tiles.set(area.unit, areaRect(area));
    if (this.seen === 0) this.firstDoneAt = area.doneAt;
    this.lastDoneAt = Math.max(this.lastDoneAt, area.doneAt);
    this.seen++;
    this.rebuildIfDue();
    await yieldTask();
  }

  private rebuildIfDue(): void {
    if (this.options.scene.dirtyBlocks() > 0 && this.gate.due()) this.rebuild();
  }

  private rebuild(): void {
    const blocks = this.gate.run(() => this.options.scene.rebuild());
    this.options.onRebuild?.(blocks);
  }

  private report(): void {
    this.options.onProgress?.(this.progress());
  }
}

interface AreaJson {
  readonly seq: number;
  readonly stage: string;
  readonly unit: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly objects: number;
  readonly done_at: string;
}

interface PageJson {
  readonly status: RunStatus;
  readonly areas: readonly AreaJson[];
  readonly after: number;
  readonly more: boolean;
  readonly total?: number | null;
}

export interface HttpRunStreamOptions {
  readonly areasUrl: (after: number) => string;
  readonly tileUrl: (unit: number) => string;
  readonly cancel: () => Promise<void>;
  readonly colorOf: (classIndex: number, local: number) => Rgba;
  readonly fetcher?: typeof fetch;
}

export function httpRunStreamSource(options: HttpRunStreamOptions): RunStreamSource {
  const fetcher = options.fetcher ?? fetch;
  return {
    async page(after, signal) {
      const response = await fetcher(options.areasUrl(after), { signal });
      if (!response.ok) throw new Error(`The run areas answered ${response.status}`);
      const body = (await response.json()) as PageJson;
      return {
        status: body.status,
        after: body.after,
        more: body.more,
        total: body.total ?? null,
        areas: body.areas.map((area) => ({
          seq: area.seq,
          stage: area.stage,
          unit: area.unit,
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          objects: area.objects,
          doneAt: Date.parse(area.done_at),
        })),
      };
    },
    async objects(area, signal) {
      const bytes = await fetchBytes(options.tileUrl(area.unit), fetcher, signal);
      return chunkPolygons(readCellChunk(await decodePfc(bytes), area.unit), options.colorOf);
    },
    cancel: options.cancel,
  };
}
