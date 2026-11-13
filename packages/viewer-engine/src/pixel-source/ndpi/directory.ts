export type ByteReader = (
  offset: number,
  length: number,
  signal?: AbortSignal,
) => Promise<Uint8Array<ArrayBuffer>>;

export interface NdpiPage {
  readonly ifd: number;
  readonly offset: number;
  readonly width: number;
  readonly height: number;
  readonly compression: number;
  readonly stripOffset: number;
  readonly stripLength: number;
  readonly sourceLens: number | null;
  readonly focalOffset: number;
  readonly resolutionUnit: number;
  readonly xResolutionOffset: number | null;
  readonly yResolutionOffset: number | null;
  readonly restartCount: number;
  readonly restartOffset: number | null;
  readonly restartHighOffset: number | null;
}

export class NdpiFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NdpiFormatError";
  }
}

const highWord = 2 ** 32;
const maxDirectories = 256;
const maxEntries = 4096;
const entryBytes = 12;
const directoryGuess = 2 + 64 * 16 + 8;
const restartChunk = 1 << 20;

const tags = {
  width: 256,
  height: 257,
  compression: 259,
  stripOffsets: 273,
  stripByteCounts: 279,
  xResolution: 282,
  yResolution: 283,
  resolutionUnit: 296,
  sourceLens: 65421,
  focalOffset: 65424,
  restartStarts: 65426,
  restartStartsHigh: 65432,
} as const;

const typeBytes: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
  16: 8,
  17: 8,
  18: 8,
};

interface Entry {
  readonly type: number;
  readonly count: number;
  readonly low: number;
  readonly high: number;
  readonly inline: boolean;
  readonly view: DataView;
  readonly at: number;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function readExactly(
  read: ByteReader,
  offset: number,
  length: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await read(offset, length, signal);
  if (bytes.length < length) {
    throw new NdpiFormatError(`The file ends before byte ${offset + length}`);
  }
  return bytes;
}

function wide(entry: Entry): number {
  return entry.low + entry.high * highWord;
}

function scalar(entry: Entry | undefined): number | null {
  if (entry === undefined || entry.count !== 1) return null;
  if (entry.type === 3) return entry.view.getUint16(entry.at + 8, true);
  if (entry.type === 4 || entry.type === 13) return wide(entry);
  if (entry.type === 9) return entry.view.getInt32(entry.at + 8, true);
  if (entry.type === 11) return entry.view.getFloat32(entry.at + 8, true);
  return null;
}

function arrayOffset(entry: Entry | undefined): number | null {
  if (entry === undefined || entry.inline) return null;
  return wide(entry);
}

async function readDirectory(
  read: ByteReader,
  offset: number,
  signal?: AbortSignal,
): Promise<{ entries: Map<number, Entry>; next: number }> {
  let bytes = await read(offset, directoryGuess, signal);
  if (bytes.length < 2) throw new NdpiFormatError(`No directory at byte ${offset}`);
  const count = viewOf(bytes).getUint16(0, true);
  if (count < 1 || count > maxEntries) {
    throw new NdpiFormatError(`The directory at byte ${offset} lists ${count} entries`);
  }
  const needed = 2 + count * (entryBytes + 4) + 8;
  if (bytes.length < needed) bytes = await readExactly(read, offset, needed, signal);
  const view = viewOf(bytes);
  const nextAt = 2 + count * entryBytes;
  const highAt = nextAt + 8;
  const entries = new Map<number, Entry>();
  for (let index = 0; index < count; index++) {
    const at = 2 + index * entryBytes;
    const tag = view.getUint16(at, true);
    const type = view.getUint16(at + 2, true);
    const size = typeBytes[type];
    if (size === undefined) {
      throw new NdpiFormatError(`Tag ${tag} has the unknown field type ${type}`);
    }
    const entryCount = view.getUint32(at + 4, true);
    if (entries.has(tag)) continue;
    entries.set(tag, {
      type,
      count: entryCount,
      low: view.getUint32(at + 8, true),
      high: view.getUint32(highAt + index * 4, true),
      inline: size * entryCount <= 4,
      view,
      at,
    });
  }
  const next = view.getUint32(nextAt, true) + view.getUint32(nextAt + 4, true) * highWord;
  return { entries, next };
}

export async function readNdpiPages(read: ByteReader, signal?: AbortSignal): Promise<NdpiPage[]> {
  const header = viewOf(await readExactly(read, 0, 12, signal));
  if (header.getUint16(0, true) !== 0x4949 || header.getUint16(2, true) !== 42) {
    throw new NdpiFormatError("The file is not a little-endian classic TIFF, as NDPI is");
  }
  let offset = header.getUint32(4, true) + header.getUint32(8, true) * highWord;
  const pages: NdpiPage[] = [];
  const seen = new Set<number>();
  while (offset !== 0) {
    if (seen.has(offset) || pages.length >= maxDirectories) {
      throw new NdpiFormatError("The directory chain loops or is too long");
    }
    seen.add(offset);
    const { entries, next } = await readDirectory(read, offset, signal);
    const width = scalar(entries.get(tags.width));
    const height = scalar(entries.get(tags.height));
    const stripOffset = scalar(entries.get(tags.stripOffsets));
    const stripLength = scalar(entries.get(tags.stripByteCounts));
    if (width !== null && height !== null && stripOffset !== null && stripLength !== null) {
      const restart = entries.get(tags.restartStarts);
      const restartHigh = entries.get(tags.restartStartsHigh);
      const restartOffset = arrayOffset(restart);
      pages.push({
        ifd: pages.length,
        offset,
        width,
        height,
        compression: scalar(entries.get(tags.compression)) ?? 1,
        stripOffset,
        stripLength,
        sourceLens: scalar(entries.get(tags.sourceLens)),
        focalOffset: scalar(entries.get(tags.focalOffset)) ?? 0,
        resolutionUnit: scalar(entries.get(tags.resolutionUnit)) ?? 2,
        xResolutionOffset: arrayOffset(entries.get(tags.xResolution)),
        yResolutionOffset: arrayOffset(entries.get(tags.yResolution)),
        restartCount: restart === undefined || restartOffset === null ? 0 : restart.count,
        restartOffset,
        restartHighOffset:
          restartHigh !== undefined && restartHigh.count === restart?.count
            ? arrayOffset(restartHigh)
            : null,
      });
    }
    offset = next;
  }
  return pages;
}

export async function readRational(
  read: ByteReader,
  offset: number,
  signal?: AbortSignal,
): Promise<number | null> {
  const view = viewOf(await readExactly(read, offset, 8, signal));
  const denominator = view.getUint32(4, true);
  return denominator === 0 ? null : view.getUint32(0, true) / denominator;
}

async function readWords(
  read: ByteReader,
  offset: number,
  count: number,
  signal?: AbortSignal,
): Promise<Uint32Array> {
  const words = new Uint32Array(count);
  const jobs: Promise<void>[] = [];
  for (let first = 0; first < count; first += restartChunk) {
    const length = Math.min(restartChunk, count - first);
    jobs.push(
      readExactly(read, offset + first * 4, length * 4, signal).then((bytes) => {
        const view = viewOf(bytes);
        for (let index = 0; index < length; index++) {
          words[first + index] = view.getUint32(index * 4, true);
        }
      }),
    );
  }
  await Promise.all(jobs);
  return words;
}

export async function readRestartStarts(
  read: ByteReader,
  page: NdpiPage,
  signal?: AbortSignal,
): Promise<Float64Array> {
  if (page.restartOffset === null || page.restartCount === 0) return new Float64Array(0);
  const [low, high] = await Promise.all([
    readWords(read, page.restartOffset, page.restartCount, signal),
    page.restartHighOffset === null
      ? null
      : readWords(read, page.restartHighOffset, page.restartCount, signal),
  ]);
  const starts = new Float64Array(page.restartCount);
  let lift = 0;
  let previous = -1;
  for (let index = 0; index < starts.length; index++) {
    const raw = low[index] ?? 0;
    let start = high === null ? raw + lift : raw + (high[index] ?? 0) * highWord;
    if (high === null && start <= previous) {
      lift += highWord;
      start += highWord;
    }
    if (start <= previous || start >= page.stripLength) {
      throw new NdpiFormatError(`Restart interval ${index} of page ${page.ifd} is out of order`);
    }
    starts[index] = start;
    previous = start;
  }
  return starts;
}
