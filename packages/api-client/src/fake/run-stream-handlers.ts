import { HttpResponse, http, type RequestHandler } from "msw";
import type { ModelRun, ModelRunDraft, RunScope } from "../generated/api.ts";
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

type Box = readonly [left: number, top: number, right: number, bottom: number];

type StreamRun = {
  readonly id: string;
  readonly projectId: string;
  readonly slideId: string;
  readonly taskId: string | null;
  readonly scope: RunScope;
  readonly box: Box | null;
  readonly units: readonly number[];
  readonly resultSetId: string;
  reads: number;
  frozen: number | null;
  cancelPolls: number;
};

export type FakeRunCell = {
  readonly number: number;
  readonly classIndex: number;
  readonly score: number;
  readonly ring: readonly (readonly [number, number])[];
};

const runs = new Map<string, StreamRun>();
let started = 0;

export function resetFakeRunStreams(): void {
  runs.clear();
  started = 0;
}

const streamSetOf = (index: number) => `00000000-0000-4000-8030-${String(index).padStart(12, "0")}`;

function boxOfScope(scope: RunScope): Box | null {
  if (scope.kind === "view") {
    return [scope.x, scope.y, scope.x + scope.width, scope.y + scope.height];
  }
  if (scope.kind !== "selection" || !scope.geometry) return null;
  const polygons =
    scope.geometry.type === "Polygon" ? [scope.geometry.coordinates] : scope.geometry.coordinates;
  const points = polygons.flat(2) as unknown as number[][];
  const xs = points.map((point) => point[0] ?? 0);
  const ys = points.map((point) => point[1] ?? 0);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function unitsIn(box: Box | null): number[] {
  const all = Array.from({ length: streamTiles }, (_, unit) => unit);
  if (box === null) return all;
  return all.filter((unit) => {
    const [x, y, width, height] = streamTileRect(unit);
    return x < box[2] && x + width > box[0] && y < box[3] && y + height > box[1];
  });
}

const finished = (run: StreamRun): number => run.frozen ?? Math.min(run.units.length, run.reads);

function statusOf(run: StreamRun): ModelRun["status"] {
  if (run.frozen !== null) return run.cancelPolls > 1 ? "cancelled" : "cancelling";
  return finished(run) === run.units.length ? "done" : "running";
}

function modelRunOf(run: StreamRun): ModelRun {
  const status = statusOf(run);
  return {
    id: run.id,
    batch_id: `${run.id}-batch`,
    project_id: run.projectId,
    slide_id: run.slideId,
    task_id: run.taskId,
    status,
    error_code: null,
    pause_reason: null,
    scope: run.scope,
    parameters: { detector: { name: "hovernet", version: "1" } },
    result_set_id: run.resultSetId,
    started_by_user_id: null,
    attempts: 1,
    created_at: createdAt,
    finished_at: status === "done" || status === "cancelled" ? createdAt : null,
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

const topScore = 255;
const cellScore = 200;

function tileCells(unit: number, box: Box | null): FakeRunCell[] {
  const [left, top] = streamTileRect(unit);
  const spacing = streamTileSide / streamCellsPerSide;
  const cells: FakeRunCell[] = [];
  for (let cell = 0; cell < streamCellsPerTile; cell++) {
    const centreX = left + (cell % streamCellsPerSide) * spacing + spacing / 2;
    const centreY = top + Math.floor(cell / streamCellsPerSide) * spacing + spacing / 2;
    if (
      box !== null &&
      (centreX < box[0] || centreX > box[2] || centreY < box[1] || centreY > box[3])
    ) {
      continue;
    }
    const radius = spacing * (0.25 + ((cell * 7 + unit) % 5) * 0.03);
    const ring = Array.from({ length: ringSides }, (_, side) => {
      const angle = (side / ringSides) * Math.PI * 2;
      return [centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius] as const;
    });
    cells.push({
      number: box === null ? cell + 1 : unit * streamCellsPerTile + cell + 1,
      classIndex: (cell + unit) % classes,
      score: cellScore / topScore,
      ring,
    });
  }
  return cells;
}

export function fakeRunCells(resultSetId: string): FakeRunCell[] | null {
  const run = [...runs.values()].find((item) => item.resultSetId === resultSetId);
  if (run === undefined || statusOf(run) !== "done") return null;
  return run.units.flatMap((unit) => tileCells(unit, run.box));
}

export function streamTileChunk(unit: number, box: Box | null = null): Uint8Array<ArrayBuffer> {
  const cells = tileCells(unit, box);
  const count = cells.length;
  const number = new Uint32Array(count);
  const offsets = new Uint32Array(count + 1);
  const points = new Float32Array(count * ringSides * 2);
  const classIndex = new Uint8Array(count);
  const score = new Uint8Array(count);
  const flags = new Uint8Array(count);
  cells.forEach((cell, index) => {
    number[index] = cell.number;
    offsets[index + 1] = (index + 1) * ringSides;
    classIndex[index] = cell.classIndex;
    score[index] = cellScore;
    cell.ring.forEach(([x, y], side) => {
      points[(index * ringSides + side) * 2] = x;
      points[(index * ringSides + side) * 2 + 1] = y;
    });
  });
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
  for (let index = after; index < done; index++) {
    const unit = run.units[index] ?? 0;
    const [x, y, width, height] = streamTileRect(unit);
    areas.push({
      seq: index + 1,
      stage: "model-running",
      unit,
      x,
      y,
      width,
      height,
      objects: tileCells(unit, run.box).length,
      done_at: new Date(Date.parse(createdAt) + (index + 1) * 20_000).toISOString(),
    });
  }
  return {
    run_id: run.id,
    status: statusOf(run),
    areas,
    after: Math.max(after, done),
    more: false,
    total: run.units.length,
  };
}

type RunParams = { projectId: string; runId: string };

export function runStreamHandlers(): RequestHandler[] {
  return [
    http.get<{ projectId: string }>("*/api/projects/:projectId/model-runs", ({ request }) => {
      if (fakeViewerScene() !== "streaming") return undefined;
      const query = new URL(request.url).searchParams;
      const slideId = query.get("slide_id");
      const statuses = query.getAll("status");
      const listed = [...runs.values()]
        .filter((run) => slideId === null || run.slideId === slideId)
        .map(modelRunOf)
        .filter((run) => statuses.length === 0 || statuses.includes(run.status));
      return HttpResponse.json(listed);
    }),
    http.post<{ projectId: string }>(
      "*/api/projects/:projectId/model-runs",
      async ({ params, request }) => {
        if (fakeViewerScene() !== "streaming") return undefined;
        const draft = (await request.clone().json()) as ModelRunDraft;
        const slideId = draft.slide_ids[0];
        if (slideId === undefined) return undefined;
        started += 1;
        const box = boxOfScope(draft.scope);
        const run: StreamRun = {
          id: `${streamRunPrefix}${started}`,
          projectId: String(params.projectId),
          slideId,
          taskId: draft.task_id ?? null,
          scope: draft.scope,
          box,
          units: unitsIn(box),
          resultSetId: streamSetOf(started),
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
        if (!run.units.slice(0, finished(run)).includes(unit)) {
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
        return new HttpResponse(streamTileChunk(unit, run.box), {
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
