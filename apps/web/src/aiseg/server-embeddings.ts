import {
  getGetSlideEmbeddingsUrl,
  getGetSlideEmbeddingTileUrl,
  type SlideEmbeddings,
} from "@parfocal/api-client";
import type { SamClient, SamEncoded } from "@parfocal/viewer-engine";
import type { PresetPatchQuery, PresetPatchReader } from "./patch-reader.ts";

export const serverEmbeddingDims: readonly number[] = [1, 256, 64, 64];
export const serverEmbeddingValues = 256 * 64 * 64;
export const serverEmbeddingDtype = "float16-le";
export const decoderEncoders: readonly string[] = ["pathosam-vit-b-histopathology-fp32"];

export interface ServerEmbeddingManifest {
  readonly encoder: string;
  readonly dtype: string;
  readonly dims: readonly number[];
  readonly level: number;
  readonly downsample: number;
  readonly tile: number;
  readonly levelWidth: number;
  readonly levelHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly tiles: Uint8Array;
}

export interface ServerEmbeddingTransport {
  manifest(slideId: string): Promise<ServerEmbeddingManifest | null>;
  tile(slideId: string, column: number, row: number): Promise<ArrayBuffer | null>;
}

export interface TileWindow {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ServerEmbeddings {
  embedding(slideId: string, window: TileWindow): Promise<Float32Array<ArrayBuffer> | null>;
  snap(
    slideId: string,
    level: number,
    size: number,
    at: PresetPatchQuery,
  ): Promise<PresetPatchQuery>;
}

export type EmbeddingSam = Pick<SamClient, "encode" | "adopt">;

export function float16Value(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

export function decodeFloat16(buffer: ArrayBuffer): Float32Array<ArrayBuffer> {
  const view = new DataView(buffer);
  const out = new Float32Array(buffer.byteLength >> 1);
  for (let index = 0; index < out.length; index++) {
    out[index] = float16Value(view.getUint16(index * 2, true));
  }
  return out;
}

export function tileOrigin(index: number, tile: number, length: number): number {
  return Math.max(0, Math.min(index * tile, length - tile));
}

function hasTile(manifest: ServerEmbeddingManifest, column: number, row: number): boolean {
  if (column < 0 || row < 0 || column >= manifest.columns || row >= manifest.rows) return false;
  const index = row * manifest.columns + column;
  return ((manifest.tiles[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

function gridIndex(origin: number, tile: number, length: number, count: number): number | null {
  for (const index of [Math.floor(origin / tile), count - 1]) {
    if (index >= 0 && index < count && tileOrigin(index, tile, length) === origin) return index;
  }
  return null;
}

function usable(manifest: ServerEmbeddingManifest | null): manifest is ServerEmbeddingManifest {
  return (
    manifest !== null &&
    manifest.dtype === serverEmbeddingDtype &&
    decoderEncoders.includes(manifest.encoder) &&
    manifest.dims.join("x") === serverEmbeddingDims.join("x")
  );
}

export function parseEmbeddingId(id: string): { slideId: string; window: TileWindow } | null {
  const split = id.lastIndexOf(":");
  if (split <= 0) return null;
  const parts = id
    .slice(split + 1)
    .split("|")
    .map((part) => Number(part));
  const [level, x, y, width, height] = parts;
  if (
    parts.length !== 5 ||
    level === undefined ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !parts.every(Number.isInteger)
  ) {
    return null;
  }
  return { slideId: id.slice(0, split), window: { level, x, y, width, height } };
}

export function createServerEmbeddings(transport: ServerEmbeddingTransport): ServerEmbeddings {
  const manifests = new Map<string, Promise<ServerEmbeddingManifest | null>>();

  function manifestFor(slideId: string): Promise<ServerEmbeddingManifest | null> {
    let known = manifests.get(slideId);
    if (known === undefined) {
      known = transport.manifest(slideId).then(
        (manifest) => (usable(manifest) ? manifest : null),
        () => {
          manifests.delete(slideId);
          return null;
        },
      );
      manifests.set(slideId, known);
    }
    return known;
  }

  return {
    async embedding(slideId, window) {
      const manifest = await manifestFor(slideId);
      if (manifest === null || window.level !== manifest.level) return null;
      if (window.width !== manifest.tile || window.height !== manifest.tile) return null;
      const column = gridIndex(window.x, manifest.tile, manifest.levelWidth, manifest.columns);
      const row = gridIndex(window.y, manifest.tile, manifest.levelHeight, manifest.rows);
      if (column === null || row === null || !hasTile(manifest, column, row)) return null;
      const body = await transport.tile(slideId, column, row);
      if (body === null || body.byteLength !== serverEmbeddingValues * 2) return null;
      return decodeFloat16(body);
    },

    async snap(slideId, level, size, at) {
      const manifest = await manifestFor(slideId);
      if (manifest === null || manifest.level !== level || manifest.tile !== size) return at;
      const { downsample, tile } = manifest;
      const column = Math.min(Math.floor(at.x / downsample / tile), manifest.columns - 1);
      const row = Math.min(Math.floor(at.y / downsample / tile), manifest.rows - 1);
      if (!hasTile(manifest, column, row)) return at;
      const half = Math.floor(tile / 2);
      return {
        ...at,
        x: (tileOrigin(column, tile, manifest.levelWidth) + half) * downsample,
        y: (tileOrigin(row, tile, manifest.levelHeight) + half) * downsample,
      };
    },
  };
}

export function withServerEmbeddings<S extends EmbeddingSam>(sam: S, server: ServerEmbeddings): S {
  async function fromServer(id: string): Promise<SamEncoded | null> {
    const parsed = parseEmbeddingId(id);
    if (parsed === null) return null;
    try {
      const embedding = await server.embedding(parsed.slideId, parsed.window);
      return embedding === null ? null : await sam.adopt(id, embedding);
    } catch {
      return null;
    }
  }

  return {
    ...sam,
    async encode(id: string, pixels: Float32Array<ArrayBuffer>): Promise<SamEncoded> {
      return (await fromServer(id)) ?? sam.encode(id, pixels);
    },
  };
}

export function withServerTiles(
  reader: PresetPatchReader,
  server: ServerEmbeddings,
  slideId: string,
): PresetPatchReader {
  return {
    ...reader,
    async read(query, signal) {
      const plan = await reader.plan(query.preset);
      const snapped = await server
        .snap(slideId, plan.level, plan.patchPixels, query)
        .catch(() => query);
      return reader.read(snapped, signal);
    },
  };
}

function manifestOf(body: SlideEmbeddings): ServerEmbeddingManifest {
  return {
    encoder: body.encoder,
    dtype: body.dtype,
    dims: body.dims,
    level: body.level,
    downsample: body.downsample,
    tile: body.tile,
    levelWidth: body.level_width,
    levelHeight: body.level_height,
    columns: body.columns,
    rows: body.rows,
    tiles: Uint8Array.from(atob(body.tiles), (char) => char.charCodeAt(0)),
  };
}

export function httpEmbeddingTransport(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): ServerEmbeddingTransport {
  const init: RequestInit = { credentials: "same-origin" };
  return {
    async manifest(slideId) {
      const response = await fetcher(getGetSlideEmbeddingsUrl(slideId), init);
      if (!response.ok) return null;
      return manifestOf((await response.json()) as SlideEmbeddings);
    },
    async tile(slideId, column, row) {
      const response = await fetcher(getGetSlideEmbeddingTileUrl(slideId, column, row), init);
      return response.ok ? response.arrayBuffer() : null;
    },
  };
}
