import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface ZarrFixtureOptions {
  readonly version: 2 | 3;
  readonly dtype: "uint8" | "uint16";
  readonly channels: 1 | 3;
  readonly width: number;
  readonly height: number;
  readonly chunk: number;
  readonly levels: number;
  readonly missing?: readonly (readonly [level: number, row: number, column: number])[];
}

export interface ZarrFixture {
  readonly root: string;
  value(level: number, channel: number, x: number, y: number): number;
  remove(): Promise<void>;
}

const microns = 0.5;
const rgb = [
  { label: "Red", color: "FF0000" },
  { label: "Green", color: "00FF00" },
  { label: "Blue", color: "0000FF" },
];

function pixel(
  options: ZarrFixtureOptions,
  level: number,
  channel: number,
  x: number,
  y: number,
): number {
  const scale = 2 ** level;
  const fx = x * scale;
  const fy = y * scale;
  const base = (fx * 3 + fy * 5 + channel * 50 + level * 17) % 251;
  return options.dtype === "uint16" ? base * 200 + channel : base;
}

function chunkBytes(
  options: ZarrFixtureOptions,
  level: number,
  width: number,
  height: number,
  row: number,
  column: number,
): Uint8Array {
  const size = options.chunk;
  const length = options.channels * size * size;
  const values = options.dtype === "uint16" ? new Uint16Array(length) : new Uint8Array(length);
  for (let channel = 0; channel < options.channels; channel++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const gx = column * size + x;
        const gy = row * size + y;
        if (gx >= width || gy >= height) continue;
        values[channel * size * size + y * size + x] = pixel(options, level, channel, gx, gy);
      }
    }
  }
  return new Uint8Array(values.buffer);
}

function axes(options: ZarrFixtureOptions) {
  const space = [
    { name: "y", type: "space", unit: "micrometer" },
    { name: "x", type: "space", unit: "micrometer" },
  ];
  return options.channels === 3 ? [{ name: "c", type: "channel" }, ...space] : space;
}

function multiscales(options: ZarrFixtureOptions) {
  const lead = options.channels === 3 ? [1] : [];
  return [
    {
      ...(options.version === 2 ? { version: "0.4" } : {}),
      axes: axes(options),
      datasets: Array.from({ length: options.levels }, (_, level) => ({
        path: String(level),
        coordinateTransformations: [
          { type: "scale", scale: [...lead, microns * 2 ** level, microns * 2 ** level] },
        ],
      })),
    },
  ];
}

function omero(options: ZarrFixtureOptions) {
  const max = options.dtype === "uint16" ? 50_200 : 255;
  const channels = options.channels === 3 ? rgb : [{ label: "Nuclei", color: "0000FF" }];
  return { channels: channels.map((channel) => ({ ...channel, window: { start: 0, end: max } })) };
}

async function put(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function writeZarrFixture(options: ZarrFixtureOptions): Promise<ZarrFixture> {
  const root = await mkdtemp(join(tmpdir(), "parfocal-zarr-"));
  const attributes = { multiscales: multiscales(options), omero: omero(options) };
  if (options.version === 2) {
    await put(join(root, ".zgroup"), JSON.stringify({ zarr_format: 2 }));
    await put(join(root, ".zattrs"), JSON.stringify(attributes));
  } else {
    await put(
      join(root, "zarr.json"),
      JSON.stringify({
        zarr_format: 3,
        node_type: "group",
        attributes: { ome: { version: "0.5", ...attributes } },
      }),
    );
  }
  for (let level = 0; level < options.levels; level++) {
    const width = Math.ceil(options.width / 2 ** level);
    const height = Math.ceil(options.height / 2 ** level);
    const shape = options.channels === 3 ? [3, height, width] : [height, width];
    const chunks =
      options.channels === 3 ? [3, options.chunk, options.chunk] : [options.chunk, options.chunk];
    const folder = join(root, String(level));
    if (options.version === 2) {
      await put(
        join(folder, ".zarray"),
        JSON.stringify({
          zarr_format: 2,
          shape,
          chunks,
          dtype: options.dtype === "uint16" ? "<u2" : "|u1",
          compressor: null,
          fill_value: 0,
          order: "C",
          filters: null,
          dimension_separator: "/",
        }),
      );
    } else {
      await put(
        join(folder, "zarr.json"),
        JSON.stringify({
          zarr_format: 3,
          node_type: "array",
          shape,
          data_type: options.dtype,
          chunk_grid: { name: "regular", configuration: { chunk_shape: chunks } },
          chunk_key_encoding: { name: "default", configuration: { separator: "/" } },
          fill_value: 0,
          codecs: [{ name: "bytes", configuration: { endian: "little" } }],
          attributes: {},
          dimension_names: options.channels === 3 ? ["c", "y", "x"] : ["y", "x"],
        }),
      );
    }
    const rows = Math.ceil(height / options.chunk);
    const columns = Math.ceil(width / options.chunk);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const skipped = options.missing?.some(
          ([l, r, c]) => l === level && r === row && c === column,
        );
        if (skipped) continue;
        const key = [...(options.channels === 3 ? ["0"] : []), String(row), String(column)];
        const path = options.version === 2 ? join(folder, ...key) : join(folder, "c", ...key);
        await put(path, chunkBytes(options, level, width, height, row, column));
      }
    }
  }
  return {
    root,
    value: (level, channel, x, y) => pixel(options, level, channel, x, y),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
