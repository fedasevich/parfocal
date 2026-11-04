import { HttpResponse, http, type RequestHandler } from "msw";
import type { CoverageBatch, CoverageGrid, SlideCoverage } from "../generated/api.ts";

const storageKey = "parfocal.fake.coverage";

type Stored = { slide_id: string; grid: CoverageGrid; seen: number[]; updated_at: string };
type Store = Record<string, Stored>;

let memory: Store = {};

function session(): Storage | null {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

function readStore(): Store {
  const stored = session()?.getItem(storageKey);
  if (stored === null || stored === undefined) return memory;
  return JSON.parse(stored) as Store;
}

function writeStore(store: Store): void {
  memory = store;
  session()?.setItem(storageKey, JSON.stringify(store));
}

export function resetFakeCoverage(): void {
  memory = {};
  session()?.removeItem(storageKey);
}

const sameGrid = (a: CoverageGrid, b: CoverageGrid) =>
  a.cell === b.cell && a.columns === b.columns && a.rows === b.rows;

function base64Of(bytes: readonly number[]): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

const countBits = (bytes: readonly number[]) =>
  bytes.reduce((sum, byte) => {
    let count = 0;
    for (let value = byte; value > 0; value >>= 1) count += value & 1;
    return sum + count;
  }, 0);

export const toSlideCoverage = (stored: Stored): SlideCoverage => ({
  slide_id: stored.slide_id,
  grid: stored.grid,
  seen: base64Of(stored.seen),
  seen_cells: countBits(stored.seen),
  updated_at: stored.updated_at,
});

export function recordFakeCoverage(
  slideId: string,
  batch: CoverageBatch,
  now: Date = new Date(),
): SlideCoverage {
  const store = readStore();
  const total = batch.grid.columns * batch.grid.rows;
  const before = store[slideId];
  const seen =
    before && sameGrid(before.grid, batch.grid)
      ? [...before.seen]
      : Array.from({ length: Math.ceil(total / 8) }, () => 0);
  for (const cell of batch.cells) {
    if (cell >= 0 && cell < total) seen[cell >> 3] = (seen[cell >> 3] ?? 0) | (1 << (cell & 7));
  }
  const next: Stored = { slide_id: slideId, grid: batch.grid, seen, updated_at: now.toISOString() };
  writeStore({ ...store, [slideId]: next });
  return toSlideCoverage(next);
}

const notMeasured = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "The slide has no measured size yet, so coverage has no grid",
      status: 409,
      code: "slide-not-measured",
    },
    { status: 409, headers: { "content-type": "application/problem+json" } },
  );

export const coverageHandlers = (): RequestHandler[] => [
  http.get<{ slideId: string }>("*/api/slides/:slideId/coverage", ({ params }) => {
    const stored = readStore()[params.slideId];
    return stored ? HttpResponse.json(toSlideCoverage(stored)) : notMeasured();
  }),
  http.post<{ slideId: string }, CoverageBatch>(
    "*/api/slides/:slideId/coverage",
    async ({ params, request }) =>
      HttpResponse.json(recordFakeCoverage(params.slideId, await request.json())),
  ),
];
