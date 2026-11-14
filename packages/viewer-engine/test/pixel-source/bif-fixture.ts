import type { SlideIndex } from "../../src/index.ts";

export type Rgb = readonly [number, number, number];

export const bifFrames = {
  columns: 3,
  rows: 2,
  frameWidth: 32,
  frameHeight: 16,
  advanceX: 26,
  advanceY: 12,
} as const;

export const bifDownsamples = [1, 2] as const;

export const stitchedSize = {
  width: (bifFrames.columns - 1) * bifFrames.advanceX + bifFrames.frameWidth,
  height: (bifFrames.rows - 1) * bifFrames.advanceY + bifFrames.frameHeight,
};

export const storedSize = {
  width: bifFrames.columns * bifFrames.frameWidth,
  height: bifFrames.rows * bifFrames.frameHeight,
};

export const tissueMark: Rgb = [200, 0, 100];

export const tissueSpot = { x: 28, y: 12, width: 4, height: 4 } as const;

export function isTissueMark(r: number, g: number, b: number): boolean {
  return r === tissueMark[0] && g === tissueMark[1] && b === tissueMark[2];
}

export function scenePixel(x: number, y: number): Rgb {
  const inSpot =
    x >= tissueSpot.x &&
    x < tissueSpot.x + tissueSpot.width &&
    y >= tissueSpot.y &&
    y < tissueSpot.y + tissueSpot.height;
  if (inSpot) return tissueMark;
  return [(x * 2 + 1) & 255, (y * 8 + 1) & 255, (x + y * 3 + 1) & 255];
}

export interface VirtualBif {
  readonly fetch: typeof globalThis.fetch;
  readonly index: SlideIndex;
}

interface Entry {
  readonly tag: number;
  readonly type: 3 | 4;
  readonly values: readonly number[];
}

function frameTile(column: number, row: number, downsample: number): Uint8Array {
  const width = bifFrames.frameWidth / downsample;
  const height = bifFrames.frameHeight / downsample;
  const tile = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = scenePixel(
        column * bifFrames.advanceX + x * downsample,
        row * bifFrames.advanceY + y * downsample,
      );
      tile.set(pixel, (y * width + x) * 3);
    }
  }
  return tile;
}

function fileBytes(): Uint8Array {
  const chunks: { offset: number; bytes: Uint8Array }[] = [];
  let end = 8;
  const place = (bytes: Uint8Array): number => {
    const offset = end;
    chunks.push({ offset, bytes });
    end += bytes.length + (bytes.length % 2);
    return offset;
  };
  const packed = (type: 3 | 4, values: readonly number[]): Uint8Array => {
    const size = type === 3 ? 2 : 4;
    const bytes = new Uint8Array(values.length * size);
    const view = new DataView(bytes.buffer);
    values.forEach((value, at) => {
      if (type === 3) view.setUint16(at * size, value, true);
      else view.setUint32(at * size, value, true);
    });
    return bytes;
  };

  const directories = bifDownsamples.map((downsample) => {
    const offsets: number[] = [];
    const counts: number[] = [];
    for (let row = 0; row < bifFrames.rows; row++) {
      for (let column = 0; column < bifFrames.columns; column++) {
        const tile = frameTile(column, row, downsample);
        offsets.push(place(tile));
        counts.push(tile.length);
      }
    }
    const entries: Entry[] = [
      { tag: 256, type: 4, values: [storedSize.width / downsample] },
      { tag: 257, type: 4, values: [storedSize.height / downsample] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [2] },
      { tag: 277, type: 3, values: [3] },
      { tag: 284, type: 3, values: [1] },
      { tag: 322, type: 4, values: [bifFrames.frameWidth / downsample] },
      { tag: 323, type: 4, values: [bifFrames.frameHeight / downsample] },
      { tag: 324, type: 4, values: offsets },
      { tag: 325, type: 4, values: counts },
    ];
    return entries.map((entry) => {
      const bytes = packed(entry.type, entry.values);
      return { ...entry, inline: bytes.length <= 4 ? bytes : null, at: place(bytes) };
    });
  });

  const directoryOffsets: number[] = [];
  const directoryBytes = directories.map((entries) => {
    const bytes = new Uint8Array(2 + entries.length * 12 + 4);
    directoryOffsets.push(place(bytes));
    return bytes;
  });
  directories.forEach((entries, level) => {
    const bytes = directoryBytes[level] ?? new Uint8Array(0);
    const view = new DataView(bytes.buffer);
    view.setUint16(0, entries.length, true);
    entries.forEach((entry, at) => {
      const base = 2 + at * 12;
      view.setUint16(base, entry.tag, true);
      view.setUint16(base + 2, entry.type, true);
      view.setUint32(base + 4, entry.values.length, true);
      if (entry.inline === null) view.setUint32(base + 8, entry.at, true);
      else bytes.set(entry.inline, base + 8);
    });
    view.setUint32(2 + entries.length * 12, directoryOffsets[level + 1] ?? 0, true);
  });

  const file = new Uint8Array(end);
  const header = new DataView(file.buffer);
  header.setUint16(0, 0x4949, true);
  header.setUint16(2, 42, true);
  header.setUint32(4, directoryOffsets[0] ?? 0, true);
  for (const chunk of chunks) file.set(chunk.bytes, chunk.offset);
  return file;
}

export function virtualBif(): VirtualBif {
  const file = fileBytes();
  const fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve) => {
      init?.signal?.throwIfAborted();
      const range = new Headers(init?.headers).get("range");
      const match = range === null ? null : /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match === null) {
        resolve(new Response(file.slice(), { status: 200 }));
        return;
      }
      const from = Number(match[1]);
      const to = Math.min(match[2] === "" ? file.length - 1 : Number(match[2]), file.length - 1);
      if (from >= file.length) {
        resolve(new Response(null, { status: 416 }));
        return;
      }
      resolve(
        new Response(file.slice(from, to + 1), {
          status: 206,
          headers: { "content-range": `bytes ${from}-${to}/${file.length}` },
        }),
      );
    })) as typeof globalThis.fetch;

  const index: SlideIndex = {
    formatId: "ventana-bif",
    tileKind: "bif-frames",
    stitching: {
      columns: bifFrames.columns,
      rows: bifFrames.rows,
      frameWidth: bifFrames.frameWidth,
      frameHeight: bifFrames.frameHeight,
      columnX: Array.from({ length: bifFrames.columns }, (_, at) => at * bifFrames.advanceX),
      rowY: Array.from({ length: bifFrames.rows }, (_, at) => at * bifFrames.advanceY),
      advanceX: bifFrames.advanceX,
      advanceY: bifFrames.advanceY,
      width: stitchedSize.width,
      height: stitchedSize.height,
    },
    levels: bifDownsamples.map((downsample) => ({
      downsample,
      width: stitchedSize.width / downsample,
      height: stitchedSize.height / downsample,
      stored: {
        width: storedSize.width / downsample,
        height: storedSize.height / downsample,
      },
    })),
  };
  return { fetch, index };
}
