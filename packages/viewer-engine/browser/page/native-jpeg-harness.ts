import { createWorkerRegionReader } from "../../src/decode/worker-reader.ts";
import {
  createDefaultPixelSourceRegistry,
  type DecodeReport,
  type PixelResult,
  type PixelSource,
  type SlideFormatId,
} from "../../src/index.ts";
import {
  largestPyramid,
  listPages,
  loadByteCounts,
  openTiff,
} from "../../src/pixel-source/tiff/directory.ts";
import {
  browserTileDecoder,
  describeJpegTiles,
  meanAbsoluteError,
  readWindowNatively,
} from "../../src/pixel-source/tiff/native-jpeg.ts";

export interface NativeJpegMeasurement {
  readonly file: string;
  readonly pageReport: DecodeReport;
  readonly workerReport: DecodeReport | null;
  readonly workerHasCreateImageBitmap: boolean;
  readonly meanAbsoluteErrorOnWindow: number | null;
  readonly nativeMs: number | null;
  readonly scriptMs: number;
  readonly window: readonly [number, number, number, number];
}

export interface NativeJpegHarness {
  measure(url: string, formatId: SlideFormatId): Promise<NativeJpegMeasurement>;
  middleTileError(url: string): Promise<number>;
}

declare global {
  interface Window {
    nativeJpegHarness: NativeJpegHarness;
  }
}

const registry = createDefaultPixelSourceRegistry();

function planesOf(result: PixelResult): readonly ArrayLike<number>[] | null {
  return result.absent ? null : result.planes;
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await run();
  return { value, ms: performance.now() - started };
}

function measureWindow(source: PixelSource): readonly [number, number, number, number] {
  const [base] = source.levels;
  if (base === undefined) throw new Error("The slide has no levels");
  const { width: tileWidth, height: tileHeight } = source.tileSize;
  const columns = Math.min(4, Math.max(1, Math.floor(base.width / tileWidth / 2)));
  const rows = Math.min(4, Math.max(1, Math.floor(base.height / tileHeight / 2)));
  const x0 = Math.floor(base.width / tileWidth / 2) * tileWidth;
  const y0 = Math.floor(base.height / tileHeight / 2) * tileHeight;
  return [
    x0,
    y0,
    Math.min(base.width, x0 + columns * tileWidth),
    Math.min(base.height, y0 + rows * tileHeight),
  ];
}

async function workerReport(url: string, formatId: SlideFormatId) {
  const reader = createWorkerRegionReader({ request: { formatId, url }, size: 1 });
  try {
    await reader.ready;
    const [report] = reader.jpegReports();
    return report ?? null;
  } finally {
    reader.dispose();
  }
}

async function measure(url: string, formatId: SlideFormatId): Promise<NativeJpegMeasurement> {
  const native = await registry.open({ formatId, url });
  const script = await registry.open({ formatId, url, nativeJpeg: "off" });
  try {
    const window = measureWindow(native);
    const scriptRead = await timed(() => script.getRaster({ level: 0, window }));
    const scriptAgain = await timed(() => script.getRaster({ level: 0, window }));
    const firstNative = await timed(() => native.getRaster({ level: 0, window }));
    const pageReport = await native.decodeReport?.();
    if (pageReport === undefined) throw new Error("The source has no decode report");
    const secondNative = await timed(() => native.getRaster({ level: 0, window }));
    const nativePlanes = planesOf(firstNative.value);
    const scriptPlanes = planesOf(scriptRead.value);
    const used = pageReport.jpeg === "native" && nativePlanes !== null && scriptPlanes !== null;
    return {
      file: url.slice(url.lastIndexOf("/") + 1),
      pageReport: (await native.decodeReport?.()) ?? pageReport,
      workerReport: await workerReport(url, formatId),
      workerHasCreateImageBitmap: await probeWorkerApis(),
      meanAbsoluteErrorOnWindow: used ? meanAbsoluteError(nativePlanes, scriptPlanes) : null,
      nativeMs: used ? Math.min(firstNative.ms, secondNative.ms) : null,
      scriptMs: Math.min(scriptRead.ms, scriptAgain.ms),
      window,
    };
  } finally {
    native.close();
    script.close();
  }
}

function probeWorkerApis(): Promise<boolean> {
  const code =
    "postMessage(typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function')";
  const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
  return new Promise((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<boolean>) => {
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message));
    });
  });
}

async function middleTileError(url: string): Promise<number> {
  const decoder = browserTileDecoder();
  if (decoder === null) throw new Error("This page has no native JPEG decoder");
  const tiff = await openTiff(new URL(url));
  const [page] = largestPyramid(await listPages(tiff));
  if (page === undefined) throw new Error("The file has no pyramid");
  const { image } = page;
  const counts = await loadByteCounts(image);
  const layout = await describeJpegTiles(image);
  if (counts === null || layout === null) throw new Error("The file has no JPEG tiles");
  let index = Math.floor(counts.length / 2);
  while (Number(counts[index]) === 0) index++;
  const columns = Math.ceil(image.getWidth() / image.getTileWidth());
  const x = (index % columns) * image.getTileWidth();
  const y = Math.floor(index / columns) * image.getTileHeight();
  const window = [x, y, x + image.getTileWidth(), y + image.getTileHeight()] as const;
  const [native, reference] = await Promise.all([
    readWindowNatively(
      {
        image,
        tileWidth: image.getTileWidth(),
        tileHeight: image.getTileHeight(),
        layout,
        isAbsent: (at) => Number(counts[at]) === 0,
      },
      decoder,
      window,
      255,
    ),
    image.readRGB({ window: [...window], interleave: false }),
  ]);
  return meanAbsoluteError(native, reference);
}

window.nativeJpegHarness = { measure, middleTileError };
