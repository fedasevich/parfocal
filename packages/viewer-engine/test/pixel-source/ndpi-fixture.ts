const highWord = 2 ** 32;
const maxRead = 8 * 1024 * 1024;

export interface FlatJpeg {
  readonly bytes: Uint8Array;
  readonly headerLength: number;
  readonly starts: readonly number[];
}

export interface FlatJpegOptions {
  readonly width: number;
  readonly height: number;
  readonly restartInterval: number;
  readonly colour: (blockX: number, blockY: number) => readonly [number, number, number];
}

function segment(marker: number, body: readonly number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 255, ...body];
}

export function flatJpeg(options: FlatJpegOptions): FlatJpeg {
  const { width, height, restartInterval, colour } = options;
  const columns = Math.ceil(width / 8);
  const rows = Math.ceil(height / 8);
  const out: number[] = [0xff, 0xd8];
  out.push(...segment(0xdb, [0, ...new Array<number>(64).fill(1)]));
  out.push(
    ...segment(0xc0, [
      8,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
      3,
      1,
      0x11,
      0,
      2,
      0x11,
      0,
      3,
      0x11,
      0,
    ]),
  );
  out.push(
    ...segment(0xc4, [0x00, 0, 0, 0, 12, ...new Array<number>(12).fill(0), ...Array(12).keys()]),
  );
  out.push(...segment(0xc4, [0x10, 1, ...new Array<number>(15).fill(0), 0]));
  if (restartInterval > 0) {
    out.push(...segment(0xdd, [restartInterval >> 8, restartInterval & 255]));
  }
  out.push(...segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]));
  const headerLength = out.length;
  const starts: number[] = [headerLength];

  let held = 0;
  let heldBits = 0;
  const put = (value: number, bits: number) => {
    for (let bit = bits - 1; bit >= 0; bit--) {
      held = (held << 1) | ((value >> bit) & 1);
      heldBits++;
      if (heldBits === 8) {
        out.push(held);
        if (held === 0xff) out.push(0);
        held = 0;
        heldBits = 0;
      }
    }
  };
  const pad = () => {
    while (heldBits !== 0) put(1, 1);
  };

  let previous = [0, 0, 0];
  let inInterval = 0;
  let restarts = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (restartInterval > 0 && inInterval === restartInterval) {
        pad();
        out.push(0xff, 0xd0 + (restarts % 8));
        restarts++;
        starts.push(out.length);
        previous = [0, 0, 0];
        inInterval = 0;
      }
      const sample = colour(column, row);
      for (let component = 0; component < 3; component++) {
        const dc = ((sample[component] ?? 0) - 128) * 8;
        const diff = dc - (previous[component] ?? 0);
        previous[component] = dc;
        const size = diff === 0 ? 0 : 32 - Math.clz32(Math.abs(diff));
        put(size, 4);
        if (size > 0) put(diff < 0 ? diff + (1 << size) - 1 : diff, size);
        put(0, 1);
      }
      inInterval++;
    }
  }
  pad();
  out.push(0xff, 0xd9);
  return { bytes: Uint8Array.from(out), headerLength, starts };
}

export function expectedRgb(sample: readonly [number, number, number]): [number, number, number] {
  const [y, cb, cr] = sample;
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  return [
    clamp(y + 1.402 * (cr - 128)),
    clamp(y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)),
    clamp(y + 1.772 * (cb - 128)),
  ];
}

export function levelColour(level: number) {
  return (blockX: number, blockY: number): [number, number, number] => [
    ((blockX * 7 + blockY * 13 + level * 40) % 200) + 20,
    128 + ((blockX % 3) - 1) * 30,
    128 + ((blockY % 3) - 1) * 30,
  ];
}

export type NdpiLayout = "high-words" | "wrapping" | "small";

export interface VirtualNdpi {
  readonly size: number;
  readonly fetch: typeof globalThis.fetch;
  readonly requests: { offset: number; length: number }[];
  readonly levels: readonly { width: number; height: number; restartInterval: number }[];
}

interface Piece {
  readonly offset: number;
  readonly bytes: Uint8Array;
}

interface PageSpec {
  readonly width: number;
  readonly height: number;
  readonly stripOffset: number;
  readonly stripLength: number;
  readonly lens: number;
  readonly focalOffset: number;
  readonly starts: readonly number[] | null;
  readonly withHighStarts: boolean;
}

function words(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (const [index, value] of values.entries()) view.setUint32(index * 4, value >>> 0, true);
  return bytes;
}

export const virtualLevels = [
  { width: 1280, height: 1088, restartInterval: 16 },
  { width: 640, height: 544, restartInterval: 80 },
  { width: 320, height: 272, restartInterval: 0 },
] as const;

export function virtualNdpi(layout: NdpiLayout): VirtualNdpi {
  const pieces: Piece[] = [];
  const pages: PageSpec[] = [];
  let cursor = 4096;
  const place = (bytes: Uint8Array): number => {
    const offset = cursor;
    pieces.push({ offset, bytes });
    cursor += bytes.length + 64;
    return offset;
  };

  const addLevel = (index: number, lens: number, focalOffset: number, gap: number) => {
    const shape = virtualLevels[index];
    if (shape === undefined) throw new Error("no such level");
    const jpeg = flatJpeg({ ...shape, colour: levelColour(index) });
    const stripOffset = cursor;
    pieces.push({ offset: stripOffset, bytes: jpeg.bytes.subarray(0, jpeg.headerLength) });
    pieces.push({
      offset: stripOffset + jpeg.headerLength + gap,
      bytes: jpeg.bytes.subarray(jpeg.headerLength),
    });
    cursor += jpeg.bytes.length + gap + 64;
    pages.push({
      width: shape.width,
      height: shape.height,
      stripOffset,
      stripLength: jpeg.bytes.length + gap,
      lens,
      focalOffset,
      starts: shape.restartInterval > 0 ? jpeg.starts.map((start) => start + gap) : null,
      withHighStarts: layout === "high-words" && gap > 0,
    });
  };

  addLevel(2, 5, 0, 0);
  addLevel(2, 5, 500, 0);
  addLevel(2, -1, 0, 0);
  addLevel(1, 10, 0, 0);
  const gap =
    layout === "high-words" ? highWord + 4096 : layout === "wrapping" ? highWord - 30000 : 0;
  addLevel(0, 20, 0, gap);

  const resolution = place(words([40000, 1]));
  const tables = pages.map((page) =>
    page.starts === null
      ? null
      : {
          low: place(words(page.starts)),
          high: page.withHighStarts
            ? place(words(page.starts.map((start) => Math.floor(start / highWord))))
            : null,
        },
  );

  const directories = pages.map((page, index) => {
    const table = tables[index] ?? null;
    const entries: { tag: number; type: number; count: number; low: number; high: number }[] = [];
    const long = (tag: number, value: number) =>
      entries.push({
        tag,
        type: 4,
        count: 1,
        low: value % highWord,
        high: Math.floor(value / highWord),
      });
    const float = new DataView(new ArrayBuffer(4));
    float.setFloat32(0, page.lens, true);
    long(256, page.width);
    long(257, page.height);
    entries.push({ tag: 259, type: 3, count: 1, low: 7, high: 0 });
    long(273, page.stripOffset);
    long(279, page.stripLength);
    entries.push({
      tag: 282,
      type: 5,
      count: 1,
      low: resolution % highWord,
      high: Math.floor(resolution / highWord),
    });
    entries.push({
      tag: 283,
      type: 5,
      count: 1,
      low: resolution % highWord,
      high: Math.floor(resolution / highWord),
    });
    entries.push({ tag: 296, type: 3, count: 1, low: 3, high: 0 });
    entries.push({ tag: 65421, type: 11, count: 1, low: float.getUint32(0, true), high: 0 });
    entries.push({ tag: 65424, type: 9, count: 1, low: page.focalOffset, high: 0 });
    if (table !== null && page.starts !== null) {
      entries.push({
        tag: 65426,
        type: 4,
        count: page.starts.length,
        low: table.low % highWord,
        high: Math.floor(table.low / highWord),
      });
      if (table.high !== null) {
        entries.push({
          tag: 65432,
          type: 4,
          count: page.starts.length,
          low: table.high % highWord,
          high: Math.floor(table.high / highWord),
        });
      }
    }
    return entries;
  });

  const directoryOffsets: number[] = [];
  let at = cursor;
  for (const entries of directories) {
    directoryOffsets.push(at);
    at += 2 + entries.length * 16 + 8 + 64;
  }
  const order = [4, 3, 0, 1, 2];
  order.forEach((pageIndex, position) => {
    const entries = directories[pageIndex];
    const offset = directoryOffsets[pageIndex];
    if (entries === undefined || offset === undefined) throw new Error("no directory");
    const nextPage = order[position + 1];
    const next = nextPage === undefined ? 0 : (directoryOffsets[nextPage] ?? 0);
    const bytes = new Uint8Array(2 + entries.length * 16 + 8);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, entries.length, true);
    entries.forEach((entry, index) => {
      const base = 2 + index * 12;
      view.setUint16(base, entry.tag, true);
      view.setUint16(base + 2, entry.type, true);
      view.setUint32(base + 4, entry.count, true);
      view.setUint32(base + 8, entry.low >>> 0, true);
      view.setUint32(2 + entries.length * 12 + 8 + index * 4, entry.high, true);
    });
    view.setUint32(2 + entries.length * 12, next % highWord, true);
    view.setUint32(2 + entries.length * 12 + 4, Math.floor(next / highWord), true);
    pieces.push({ offset, bytes });
  });
  const size = at;

  const first = directoryOffsets[order[0] ?? 0] ?? 0;
  const header = new Uint8Array(12);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, 0x4949, true);
  headerView.setUint16(2, 42, true);
  headerView.setUint32(4, first % highWord, true);
  headerView.setUint32(8, Math.floor(first / highWord), true);
  pieces.push({ offset: 0, bytes: header });

  const requests: { offset: number; length: number }[] = [];
  const answer = (init?: RequestInit): Response => {
    init?.signal?.throwIfAborted();
    const range = new Headers(init?.headers).get("range");
    const match = range === null ? null : /^bytes=(\d+)-(\d+)$/.exec(range);
    if (match === null) return new Response(null, { status: 200 });
    const from = Number(match[1]);
    const to = Math.min(Number(match[2]), size - 1);
    if (from >= size) return new Response(null, { status: 416 });
    const length = to - from + 1;
    if (length > maxRead) throw new Error(`A read of ${length} bytes is too large`);
    requests.push({ offset: from, length });
    const body = new Uint8Array(length);
    for (const piece of pieces) {
      const start = Math.max(from, piece.offset);
      const end = Math.min(to + 1, piece.offset + piece.bytes.length);
      if (start < end) {
        body.set(piece.bytes.subarray(start - piece.offset, end - piece.offset), start - from);
      }
    }
    return new Response(body, { status: 206 });
  };
  const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      resolve(answer(init));
    })) as typeof globalThis.fetch;

  return { size, fetch, requests, levels: virtualLevels };
}
