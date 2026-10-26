import { createWorkerRegionReader } from "../../src/decode/worker-reader.ts";
import { createDefaultPixelSourceRegistry, type SlideFormatId } from "../../src/index.ts";

export interface TileSummary {
  readonly tile: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly greyShare: number;
  readonly whiteShare: number;
  readonly means: readonly number[];
}

export interface Jpeg2000Report {
  readonly workerTiles: readonly TileSummary[];
  readonly workerError: string | null;
  readonly pageOpened: boolean;
  readonly pageOpenError: string | null;
  readonly pageReadError: string | null;
  readonly pageReadErrorName: string | null;
}

export interface Jpeg2000Harness {
  run(
    url: string,
    formatId: SlideFormatId,
    tiles: readonly (readonly [number, number])[],
  ): Promise<Jpeg2000Report>;
}

declare global {
  interface Window {
    jpeg2000Harness: Jpeg2000Harness;
  }
}

const damagedGrey = 160;

const registry = createDefaultPixelSourceRegistry();

function summarise(
  tile: readonly [number, number],
  data: Uint8Array,
  width: number,
  height: number,
): TileSummary {
  const pixels = width * height;
  const totals = [0, 0, 0];
  let grey = 0;
  let white = 0;
  for (let at = 0; at < pixels; at++) {
    const red = data[at * 3] ?? 0;
    const green = data[at * 3 + 1] ?? 0;
    const blue = data[at * 3 + 2] ?? 0;
    totals[0] = (totals[0] ?? 0) + red;
    totals[1] = (totals[1] ?? 0) + green;
    totals[2] = (totals[2] ?? 0) + blue;
    if (red === damagedGrey && green === damagedGrey && blue === damagedGrey) grey++;
    if (red === 255 && green === 255 && blue === 255) white++;
  }
  return {
    tile,
    width,
    height,
    greyShare: grey / pixels,
    whiteShare: white / pixels,
    means: totals.map((total) => total / pixels),
  };
}

async function readInWorker(
  url: string,
  formatId: SlideFormatId,
  tiles: readonly (readonly [number, number])[],
): Promise<{ summaries: TileSummary[]; error: string | null }> {
  const reader = createWorkerRegionReader({ request: { formatId, url }, size: 1 });
  const summaries: TileSummary[] = [];
  try {
    await reader.ready;
    for (const tile of tiles) {
      const [x, y] = tile;
      const region = {
        backing: 0,
        residual: 1,
        window: [x * 256, y * 256, x * 256 + 256, y * 256 + 256] as const,
        width: 256,
        height: 256,
      };
      const result = await reader.read(region, { x: x * 256, y: y * 256 });
      summaries.push(summarise(tile, result.data, result.width, result.height));
    }
    return { summaries, error: null };
  } catch (error) {
    return { summaries, error: error instanceof Error ? error.message : String(error) };
  } finally {
    reader.dispose();
  }
}

async function readOnPage(
  url: string,
  formatId: SlideFormatId,
): Promise<
  Pick<Jpeg2000Report, "pageOpened" | "pageOpenError" | "pageReadError" | "pageReadErrorName">
> {
  let source: Awaited<ReturnType<typeof registry.open>>;
  try {
    source = await registry.open({ formatId, url });
  } catch (error) {
    return {
      pageOpened: false,
      pageOpenError: error instanceof Error ? error.message : String(error),
      pageReadError: null,
      pageReadErrorName: null,
    };
  }
  try {
    await source.getTile({ level: 0, x: 1, y: 1 });
    return { pageOpened: true, pageOpenError: null, pageReadError: null, pageReadErrorName: null };
  } catch (error) {
    return {
      pageOpened: true,
      pageOpenError: null,
      pageReadError: error instanceof Error ? error.message : String(error),
      pageReadErrorName: error instanceof Error ? error.name : null,
    };
  } finally {
    source.close();
  }
}

async function run(
  url: string,
  formatId: SlideFormatId,
  tiles: readonly (readonly [number, number])[],
): Promise<Jpeg2000Report> {
  const worker = await readInWorker(url, formatId, tiles);
  const page = await readOnPage(url, formatId);
  return { workerTiles: worker.summaries, workerError: worker.error, ...page };
}

window.jpeg2000Harness = { run };
