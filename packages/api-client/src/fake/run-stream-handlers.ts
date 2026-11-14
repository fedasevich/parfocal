import { HttpResponse, http, type RequestHandler } from "msw";
import type { ModelRun, ModelRunDraft } from "../generated/api.ts";
import { fakeViewerScene } from "./viewer-scene.ts";

export const streamRunPrefix = "stream-run-";
export const streamTileSide = 512;
export const streamTileColumns = 4;
export const streamTileRows = 3;
export const streamTiles = streamTileColumns * streamTileRows;
export const streamCellsPerSide = 6;
export const streamCellsPerTile = streamCellsPerSide * streamCellsPerSide;

const ringSides = 12;
const classes = 4;
const createdAt = "2026-11-14T09:00:00Z";

type StreamRun = {
  readonly id: string;
  readonly projectId: string;
  readonly slideId: string;
  reads: number;
  frozen: number | null;
  cancelPolls: number;
};

const runs = new Map<string, StreamRun>();
let started = 0;

export function resetFakeRunStreams(): void {
  runs.clear();
  started = 0;
}

const finished = (run: StreamRun): number => run.frozen ?? Math.min(streamTiles, run.reads);

function statusOf(run: StreamRun): ModelRun["status"] {
  if (run.frozen !== null) return run.cancelPolls > 1 ? "cancelled" : "cancelling";
  return finished(run) === streamTiles ? "done" : "running";
}

function modelRunOf(run: StreamRun): ModelRun {
  const status = statusOf(run);
  return {
    id: run.id,
    batch_id: `${run.id}-batch`,
    project_id: run.projectId,
    slide_id: run.slideId,
    task_id: null,
    status,
    error_code: null,
    pause_reason: null,
    scope: { kind: "slide" },
    parameters: { detector: { name: "hovernet", version: "1" } },
    result_set_id: null,
    started_by_user_id: null,
    attempts: 1,
    created_at: createdAt,
    finished_at: null,
    stages: [],
    actions: status === "running" ? ["cancel"] : [],
  } as unknown as ModelRun;
}

const align = 8;
const pad = (length: number) => (align - (length % align)) % align;

type Field = {
  readonly name: string;
  readonly type: "u1" | "u4" | "f4";
  readonly data: Uint8Array | Uint32Array | Float32Array;
};

function encodePfc(
  header: Record<string, unknown>,
  fields: readonly Field[],
): Uint8Array<ArrayBuffer> {
  const described: unknown[] = [];
  let size = 0;
  for (const field of fields) {
    size += pad(size);
    described.push({ name: field.name, type: field.type, offset: size, length: field.data.length });
    size += field.data.byteLength;
  }
  const json = JSON.stringify({ ...header, fields: described });
  const head = new TextEncoder().encode(json + " ".repeat(pad(json.length + 8)));
  const out = new Uint8Array(8 + head.length + size);
  out.set([0x50, 0x46, 0x43, 0x31]);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  let offset = 0;
  for (const field of fields) {
    offset += pad(offset);
    out.set(
      new Uint8Array(field.data.buffer, field.data.byteOffset, field.data.byteLength),
      8 + head.length + offset,
    );
    offset += field.data.byteLength;
  }
  return out;
}

export function streamTileRect(unit: number): readonly [number, number, number, number] {
  const x = (unit % streamTileColumns) * streamTileSide;
  const y = Math.floor(unit / streamTileColumns) * streamTileSide;
  return [x, y, streamTileSide, streamTileSide];
}

export function streamTileChunk(unit: number): Uint8Array<ArrayBuffer> {
  const [left, top] = streamTileRect(unit);
  const spacing = streamTileSide / streamCellsPerSide;
  const count = streamCellsPerTile;
  const number = new Uint32Array(count);
  const offsets = new Uint32Array(count + 1);
  const points = new Float32Array(count * ringSides * 2);
  const classIndex = new Uint8Array(count);
  const score = new Uint8Array(count);
  const flags = new Uint8Array(count);
  for (let cell = 0; cell < count; cell++) {
    const centreX = left + (cell % streamCellsPerSide) * spacing + spacing / 2;
    const centreY = top + Math.floor(cell / streamCellsPerSide) * spacing + spacing / 2;
    const radius = spacing * (0.25 + ((cell * 7 + unit) % 5) * 0.03);
    number[cell] = cell + 1;
    offsets[cell + 1] = (cell + 1) * ringSides;
    classIndex[cell] = (cell + unit) % classes;
    score[cell] = 200;
    for (let side = 0; side < ringSides; side++) {
      const angle = (side / ringSides) * Math.PI * 2;
      points[(cell * ringSides + side) * 2] = centreX + Math.cos(angle) * radius;
      points[(cell * ringSides + side) * 2 + 1] = centreY + Math.sin(angle) * radius;
    }
  }
  return encodePfc({ version: 1, kind: "cells", count, classes, chunk: unit }, [
    { name: "number", type: "u4", data: number },
    { name: "offsets", type: "u4", data: offsets },
    { name: "points", type: "f4", data: points },
    { name: "class", type: "u1", data: classIndex },
    { name: "score", type: "u1", data: score },
    { name: "flags", type: "u1", data: flags },
  ]);
}

function areasOf(run: StreamRun, after: number) {
  const done = finished(run);
  const areas = [];
  for (let unit = after; unit < done; unit++) {
    const [x, y, width, height] = streamTileRect(unit);
    areas.push({
      seq: unit + 1,
      stage: "model-running",
      unit,
      x,
      y,
      width,
      height,
      objects: streamCellsPerTile,
      done_at: new Date(Date.parse(createdAt) + (unit + 1) * 20_000).toISOString(),
    });
  }
  return {
    run_id: run.id,
    status: statusOf(run),
    areas,
    after: Math.max(after, done),
    more: false,
    total: streamTiles,
  };
}

type RunParams = { projectId: string; runId: string };

export function runStreamHandlers(): RequestHandler[] {
  return [
    http.post<{ projectId: string }>(
      "*/api/projects/:projectId/model-runs",
      async ({ params, request }) => {
        if (fakeViewerScene() !== "streaming") return undefined;
        const draft = (await request.clone().json()) as ModelRunDraft;
        const slideId = draft.slide_ids[0];
        if (slideId === undefined) return undefined;
        started += 1;
        const run: StreamRun = {
          id: `${streamRunPrefix}${started}`,
          projectId: String(params.projectId),
          slideId,
          reads: 0,
          frozen: null,
          cancelPolls: 0,
        };
        runs.set(run.id, run);
        return HttpResponse.json([modelRunOf(run)], { status: 201 });
      },
    ),
    http.get<RunParams>(
      "*/api/projects/:projectId/model-runs/:runId/areas",
      ({ params, request }) => {
        const run = runs.get(String(params.runId));
        if (run === undefined) return undefined;
        if (run.frozen === null) run.reads += 1;
        else run.cancelPolls += 1;
        const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
        return HttpResponse.json(areasOf(run, after));
      },
    ),
    http.get<RunParams & { unit: string }>(
      "*/api/projects/:projectId/model-runs/:runId/tiles/:unit",
      ({ params }) => {
        const run = runs.get(String(params.runId));
        if (run === undefined) return undefined;
        const unit = Number(params.unit);
        if (!Number.isInteger(unit) || unit < 0 || unit >= finished(run)) {
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "This tile of the run has not finished",
              status: 404,
              code: "tile-not-finished",
            },
            { status: 404, headers: { "content-type": "application/problem+json" } },
          );
        }
        return new HttpResponse(streamTileChunk(unit), {
          headers: { "content-type": "application/vnd.parfocal.cells" },
        });
      },
    ),
    http.post<RunParams>("*/api/projects/:projectId/model-runs/:runId/cancel", ({ params }) => {
      const run = runs.get(String(params.runId));
      if (run === undefined) return undefined;
      if (run.frozen === null && statusOf(run) === "running") run.frozen = finished(run);
      return HttpResponse.json(modelRunOf(run));
    }),
    http.get<RunParams>("*/api/projects/:projectId/model-runs/:runId", ({ params }) => {
      const run = runs.get(String(params.runId));
      return run === undefined ? undefined : HttpResponse.json(modelRunOf(run));
    }),
  ];
}
