import type { MicronsPerPixel, SlideIndex, SlideIndexLevel } from "../../src/index.ts";
import {
  type ByteReader,
  type NdpiPage,
  readNdpiPages,
  readRestartStarts,
} from "../../src/pixel-source/ndpi/directory.ts";
import { parseNdpiFrame } from "../../src/pixel-source/ndpi/jpeg.ts";
import { rangeReader } from "../../src/pixel-source/ndpi/ndpi-source.ts";

function slideLevels(pages: readonly NdpiPage[]): NdpiPage[] {
  const levels: NdpiPage[] = [];
  const candidates = pages
    .filter((page) => (page.sourceLens === null || page.sourceLens > 0) && page.focalOffset === 0)
    .sort((a, b) => b.width - a.width);
  for (const page of candidates) {
    const previous = levels.at(-1);
    if (previous === undefined || page.width < previous.width) levels.push(page);
  }
  return levels;
}

async function indexLevel(
  read: ByteReader,
  page: NdpiPage,
  downsample: number,
): Promise<SlideIndexLevel> {
  const shape = {
    page: page.ifd,
    ifdOffset: page.offset,
    downsample,
    width: page.width,
    height: page.height,
  };
  if (page.restartCount === 0) {
    return {
      ...shape,
      jpegHeader: null,
      tileOffsetGaps: [page.stripOffset],
      tileByteCounts: [page.stripLength],
    };
  }
  const frame = parseNdpiFrame(await read(page.stripOffset, 65536));
  if (frame === null) throw new Error("no JPEG scan header");
  const starts = await readRestartStarts(read, page);
  const counts = Array.from(
    starts,
    (start, index) => (starts[index + 1] ?? page.stripLength) - start,
  );
  return {
    ...shape,
    jpegHeader: Buffer.from(frame.header).toString("base64"),
    tileOffsetGaps: counts.map((_, index) =>
      index === 0 ? page.stripOffset + (starts[0] ?? 0) : 0,
    ),
    tileByteCounts: counts,
  };
}

export async function ndpiIndexOf(
  url: string,
  fetcher: typeof globalThis.fetch,
  micronsPerPixel: MicronsPerPixel | null,
): Promise<SlideIndex> {
  const read = rangeReader(url, fetcher);
  const pages = slideLevels(await readNdpiPages(read));
  const base = pages[0];
  if (base === undefined) throw new Error("no slide levels");
  return {
    version: 1,
    formatId: "hamamatsu-ndpi",
    tileKind: "ndpi-restart",
    littleEndian: true,
    bigTiff: false,
    micronsPerPixel,
    levels: await Promise.all(
      pages.map((page) => indexLevel(read, page, Math.round(base.width / page.width))),
    ),
  };
}
