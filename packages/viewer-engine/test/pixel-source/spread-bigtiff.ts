import { open } from "node:fs/promises";
import { deflateSync } from "node:zlib";

export interface SpreadBigTiffOptions {
  readonly path: string;
  readonly levels: number;
  readonly baseSize: number;
  readonly tileSize: number;
}

export interface SpreadBigTiff {
  readonly sidecar: unknown;
  readonly bytes: number;
}

const block = 1024 * 1024;
const entrySize = 20;

const type = { short: 3, long: 4, long8: 16 } as const;

interface Entry {
  readonly tag: number;
  readonly type: number;
  readonly values: readonly number[];
}

function valueSize(entryType: number): number {
  return entryType === type.short ? 2 : entryType === type.long ? 4 : 8;
}

function writeValues(view: DataView, at: number, entryType: number, values: readonly number[]) {
  values.forEach((value, index) => {
    const position = at + index * valueSize(entryType);
    if (entryType === type.short) view.setUint16(position, value, true);
    else if (entryType === type.long) view.setUint32(position, value, true);
    else view.setBigUint64(position, BigInt(value), true);
  });
}

function directory(at: number, entries: readonly Entry[], next: number): Uint8Array {
  const tableBytes = 8 + entries.length * entrySize + 8;
  const outOfLine = entries
    .map((entry) => entry.values.length * valueSize(entry.type))
    .filter((size) => size > 8)
    .reduce((sum, size) => sum + size, 0);
  const bytes = new Uint8Array(tableBytes + outOfLine);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(entries.length), true);
  let spill = tableBytes;
  entries.forEach((entry, index) => {
    const base = 8 + index * entrySize;
    view.setUint16(base, entry.tag, true);
    view.setUint16(base + 2, entry.type, true);
    view.setBigUint64(base + 4, BigInt(entry.values.length), true);
    const size = entry.values.length * valueSize(entry.type);
    if (size <= 8) {
      writeValues(view, base + 12, entry.type, entry.values);
    } else {
      view.setBigUint64(base + 12, BigInt(at + spill), true);
      writeValues(view, spill, entry.type, entry.values);
      spill += size;
    }
  });
  view.setBigUint64(8 + entries.length * entrySize, BigInt(next), true);
  return bytes;
}

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function entriesOf(
  index: number,
  size: number,
  tileSize: number,
  offsets: readonly number[],
  counts: readonly number[],
): Entry[] {
  return [
    { tag: 254, type: type.long, values: [index === 0 ? 0 : 1] },
    { tag: 256, type: type.long, values: [size] },
    { tag: 257, type: type.long, values: [size] },
    { tag: 258, type: type.short, values: [8, 8, 8] },
    { tag: 259, type: type.short, values: [8] },
    { tag: 262, type: type.short, values: [2] },
    { tag: 277, type: type.short, values: [3] },
    { tag: 284, type: type.short, values: [1] },
    { tag: 322, type: type.short, values: [tileSize] },
    { tag: 323, type: type.short, values: [tileSize] },
    { tag: 324, type: type.long8, values: offsets },
    { tag: 325, type: type.long, values: counts },
  ];
}

export async function writeSpreadBigTiff(options: SpreadBigTiffOptions): Promise<SpreadBigTiff> {
  const { tileSize } = options;
  const tile = deflateSync(Buffer.alloc(tileSize * tileSize * 3, 0xe0));
  let cursor = 16;
  const layout = Array.from({ length: options.levels }, (_, level) => {
    const size = Math.max(1, Math.floor(options.baseSize / 2 ** level));
    const across = Math.ceil(size / tileSize);
    const tiles = across * across;
    const tilesAt = cursor;
    const ifdAt = roundUp(tilesAt + tiles * tile.length, block) + 64;
    const offsets = Array.from({ length: tiles }, (_, index) => tilesAt + index * tile.length);
    const counts = new Array<number>(tiles).fill(tile.length);
    const entries = entriesOf(level, size, tileSize, offsets, counts);
    cursor = ifdAt + directory(ifdAt, entries, 0).length;
    return { level, size, tiles, ifdAt, offsets, counts, entries };
  });
  const handle = await open(options.path, "w");
  try {
    const header = new Uint8Array(16);
    const headerView = new DataView(header.buffer);
    headerView.setUint16(0, 0x4949, false);
    headerView.setUint16(2, 43, true);
    headerView.setUint16(4, 8, true);
    headerView.setBigUint64(8, BigInt(layout[0]?.ifdAt ?? 0), true);
    await handle.write(header, 0, header.length, 0);
    for (const [index, level] of layout.entries()) {
      const run = Buffer.concat(new Array<Buffer>(level.tiles).fill(tile));
      await handle.write(run, 0, run.length, level.offsets[0] ?? 16);
      const bytes = directory(level.ifdAt, level.entries, layout[index + 1]?.ifdAt ?? 0);
      await handle.write(bytes, 0, bytes.length, level.ifdAt);
    }
  } finally {
    await handle.close();
  }
  return {
    bytes: cursor,
    sidecar: {
      version: 1,
      formatId: "generic-tiff",
      tileKind: "grid",
      littleEndian: true,
      bigTiff: true,
      micronsPerPixel: { x: 0.25, y: 0.25 },
      levels: layout.map((level) => ({
        page: level.level,
        subIfd: null,
        ifdOffset: level.ifdAt,
        tileOffsetGaps: level.offsets.map((offset, index) => (index === 0 ? offset : 0)),
        tileByteCounts: level.counts,
        downsample: 2 ** level.level,
        width: level.size,
        height: level.size,
        tileWidth: tileSize,
        tileHeight: tileSize,
        jpegHeader: null,
        siblings: [],
      })),
    },
  };
}
