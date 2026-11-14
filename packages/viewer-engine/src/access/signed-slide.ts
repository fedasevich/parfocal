import { TILE_INDEX_FILE } from "../pixel-source/tile-index.ts";
import type {
  MicronsPerPixel,
  OpenRequest,
  SlideFormatId,
  SlideIndex,
  SlideIndexLevel,
  SlideStitching,
} from "../pixel-source/types.ts";
import { slideFormatIds, UnsupportedFormatError } from "../pixel-source/types.ts";
import { absoluteUrl } from "../pixel-source/url.ts";
import { type Fetcher, TileAccess } from "./tile-access.ts";

export const LEVEL_TABLE_FILE = "levels.json";

export class LevelTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LevelTableError";
  }
}

export class SlideBytesError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(url: string, status: number) {
    super(`The slide bytes at ${url} answered ${status}`);
    this.name = "SlideBytesError";
    this.status = status;
    this.url = url;
  }
}

export class CrossOriginSlideBytesError extends Error {
  readonly url: string;

  constructor(url: string, origin: string) {
    super(`Slide bytes are read only from the app origin ${origin}, not from ${url}`);
    this.name = "CrossOriginSlideBytesError";
    this.url = url;
  }
}

export interface LevelTableLevel {
  readonly downsample: number;
  readonly width: number;
  readonly height: number;
  readonly stored: { readonly width: number; readonly height: number };
}

export interface LevelTable {
  readonly levels: readonly LevelTableLevel[];
  readonly micronsPerPixel: MicronsPerPixel | null;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new LevelTableError(`The level table has no ${what}`);
  }
  return value as Record<string, unknown>;
}

function positive(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new LevelTableError(`The level table has an invalid ${what}`);
  }
  return value;
}

function optionalMicrons(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function parseLevelTable(document: unknown): LevelTable {
  const table = record(document, "table");
  const rawLevels = table["levels"];
  if (!Array.isArray(rawLevels) || rawLevels.length === 0) {
    throw new LevelTableError("The level table lists no levels");
  }
  const levels = rawLevels.map((raw): LevelTableLevel => {
    const level = record(raw, "level");
    const stored = record(level["stored"], "stored size");
    return {
      downsample: positive(level["downsample"], "downsample"),
      width: positive(level["width"], "width"),
      height: positive(level["height"], "height"),
      stored: {
        width: positive(stored["width"], "stored width"),
        height: positive(stored["height"], "stored height"),
      },
    };
  });
  const scale = table["scale"] === undefined ? {} : record(table["scale"], "scale");
  const x = optionalMicrons(scale["mpp_x"]);
  const y = optionalMicrons(scale["mpp_y"]);
  return { levels, micronsPerPixel: x === null || y === null ? null : { x, y } };
}

export function slideIndexFromLevelTable(table: LevelTable, formatId: SlideFormatId): SlideIndex {
  const levels: SlideIndexLevel[] = table.levels.map((level) => ({
    stored: level.stored,
    downsample: level.downsample,
    width: level.width,
    height: level.height,
  }));
  return {
    formatId,
    levels,
    ...(table.micronsPerPixel === null ? {} : { micronsPerPixel: table.micronsPerPixel }),
  };
}

const namedFormats: readonly (readonly [RegExp, SlideFormatId])[] = [
  [/\.ome\.tiff?$/i, "ome-tiff"],
  [/\.svs$/i, "aperio-svs"],
  [/\.scn$/i, "leica-scn"],
  [/\.ndpi$/i, "hamamatsu-ndpi"],
  [/\.bif$/i, "ventana-bif"],
  [/\.avs$/i, "argos-avs"],
  [/\.mrxs$/i, "mirax"],
  [/\.dcm$/i, "dicom"],
  [/\.zarr$/i, "ome-zarr"],
  [/\.tiff?$/i, "generic-tiff"],
];

export function slideFormatFromName(name: string): SlideFormatId | null {
  return namedFormats.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function identifiedSlideFormat(format: string | null | undefined): SlideFormatId | null {
  return slideFormatIds.find((formatId) => formatId === format) ?? null;
}

export interface SignedSlideOptions {
  readonly access: TileAccess;
  readonly basePath: string;
  readonly original: string;
  readonly baseUrl?: string | URL;
  readonly formatId?: SlideFormatId;
  readonly identifiedFormat?: string | null;
  readonly fetcher?: Fetcher;
  readonly signal?: AbortSignal;
}

function directoryUrl(basePath: string, baseUrl: string | URL | undefined): URL {
  const base = absoluteUrl(basePath, baseUrl);
  return base.pathname.endsWith("/") ? base : new URL(`${base.pathname}/`, base);
}

function appOrigin(baseUrl: string | URL | undefined): string | null {
  const page = baseUrl ?? (typeof location === "undefined" ? undefined : location.href);
  return page === undefined ? null : new URL(page).origin;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isFrameStitching(value: unknown): value is SlideStitching {
  if (typeof value !== "object" || value === null) return false;
  const stitching = value as Record<string, unknown>;
  return ["columns", "rows", "frameWidth", "frameHeight"].every((key) => {
    const size = stitching[key];
    return typeof size === "number" && Number.isFinite(size) && size > 0;
  });
}

export function frameStitchingOf(document: unknown): SlideStitching | null {
  if (typeof document !== "object" || document === null) return null;
  const sidecar = document as Record<string, unknown>;
  if (sidecar["tileKind"] !== "bif-frames") return null;
  return isFrameStitching(sidecar["stitching"]) ? sidecar["stitching"] : null;
}

async function withFrameStitching(
  table: SlideIndex,
  sidecarUrl: string,
  options: SignedSlideOptions,
): Promise<SlideIndex> {
  const { access, fetcher, signal } = options;
  const response = await access.fetch(sidecarUrl, signal === undefined ? {} : { signal }, fetcher);
  if (response.status === 404) return table;
  if (!response.ok) throw new SlideBytesError(sidecarUrl, response.status);
  const stitching = frameStitchingOf(await response.json());
  return stitching === null ? table : { ...table, tileKind: "bif-frames", stitching };
}

export async function signedOpenRequest(options: SignedSlideOptions): Promise<OpenRequest> {
  const { access, basePath, original, baseUrl, fetcher, signal } = options;
  const formatId =
    options.formatId ??
    identifiedSlideFormat(options.identifiedFormat) ??
    slideFormatFromName(original);
  if (formatId === null) throw new UnsupportedFormatError(original);
  const directory = directoryUrl(basePath, baseUrl);
  const origin = appOrigin(baseUrl);
  if (origin !== null && directory.origin !== origin) {
    throw new CrossOriginSlideBytesError(directory.href, origin);
  }
  const tableUrl = new URL(LEVEL_TABLE_FILE, directory).href;
  const response = await access.fetch(tableUrl, signal === undefined ? {} : { signal }, fetcher);
  if (!response.ok) throw new SlideBytesError(tableUrl, response.status);
  const table = slideIndexFromLevelTable(parseLevelTable(await response.json()), formatId);
  const index =
    formatId === "ventana-bif"
      ? await withFrameStitching(table, new URL(TILE_INDEX_FILE, directory).href, options)
      : table;
  const url = new URL(encodeURIComponent(original), directory).href;
  return {
    formatId,
    url,
    index,
    fetch: (input, init) => access.fetch(requestUrl(input), init, fetcher),
  };
}

export interface TileGrant {
  readonly token: string;
  readonly lifetimeSeconds: number;
  readonly basePath: string;
  readonly original: string;
  readonly format?: string | null;
}

export interface SlideAccess {
  readonly access: TileAccess;
  readonly grant: () => Promise<TileGrant>;
}

export function createSlideAccess(
  load: (previousToken: string | null) => Promise<TileGrant>,
  now?: () => number,
): SlideAccess {
  let latest: TileGrant | null = null;
  const access = new TileAccess(async (previous) => {
    latest = await load(previous);
    return { token: latest.token, lifetimeSeconds: latest.lifetimeSeconds };
  }, now);
  return {
    access,
    grant: async () => {
      await access.token();
      if (latest === null) throw new Error("The tile access was never granted");
      return latest;
    },
  };
}
