import { TILE_INDEX_FILE } from "../pixel-source/tile-index.ts";
import type {
  MicronsPerPixel,
  OpenRequest,
  RestrictedRange,
  SlideFormatId,
  SlideIndex,
  SlideIndexLevel,
  SlideStitching,
  TagValueRange,
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

export class SlideNeedsReingestError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`The frame placement in ${url} is missing, so the slide must be ingested again`);
    this.name = "SlideNeedsReingestError";
    this.url = url;
  }
}

export class SlideHasSeveralScanAreasError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`The sidecar ${url} records several scan areas, which cannot be placed yet`);
    this.name = "SlideHasSeveralScanAreasError";
    this.url = url;
  }
}

export interface LevelDirectory {
  readonly page: number;
  readonly subIfd: number | null;
  readonly ifdOffset: number;
  readonly ifdBytes?: number;
  readonly valueRanges?: readonly TagValueRange[];
}

export interface LocatedDirectory extends LevelDirectory {
  readonly siblings: readonly LevelDirectory[];
}

export interface LevelTableLevel {
  readonly downsample: number;
  readonly width: number;
  readonly height: number;
  readonly stored: { readonly width: number; readonly height: number };
  readonly directory?: LocatedDirectory;
}

export interface TiffHeaderFacts {
  readonly littleEndian: boolean;
  readonly bigTiff: boolean;
}

export interface LevelTable {
  readonly levels: readonly LevelTableLevel[];
  readonly micronsPerPixel: MicronsPerPixel | null;
  readonly header: TiffHeaderFacts | null;
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

function wholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function valueRangesOf(value: unknown): TagValueRange[] | null {
  if (!Array.isArray(value)) return null;
  const ranges = value.filter(
    (range: unknown): range is TagValueRange =>
      Array.isArray(range) &&
      range.length === 3 &&
      range.every(wholeNumber) &&
      Number(range[2]) > 0,
  );
  return ranges.length === value.length ? ranges : null;
}

function directoryOf(value: unknown): LevelDirectory | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  const { page, subIfd, ifdOffset, ifdBytes } = entry;
  if (!wholeNumber(page) || !wholeNumber(ifdOffset) || ifdOffset === 0) return null;
  if (subIfd !== null && subIfd !== undefined && !wholeNumber(subIfd)) return null;
  const located = { page, subIfd: subIfd ?? null, ifdOffset };
  const valueRanges = valueRangesOf(entry["valueRanges"]);
  if (!wholeNumber(ifdBytes) || ifdBytes === 0 || valueRanges === null) return located;
  return { ...located, ifdBytes, valueRanges };
}

function headerOf(table: Record<string, unknown>): TiffHeaderFacts | null {
  const { littleEndian, bigTiff } = table;
  if (typeof littleEndian !== "boolean" || typeof bigTiff !== "boolean") return null;
  return { littleEndian, bigTiff };
}

function locatedLevel(level: Record<string, unknown>): LocatedDirectory | null {
  const directory = directoryOf(level);
  const rawSiblings = level["siblings"] ?? [];
  if (directory === null || !Array.isArray(rawSiblings)) return null;
  const siblings = rawSiblings.map(directoryOf);
  if (siblings.some((sibling) => sibling === null)) return null;
  return { ...directory, siblings: siblings as LevelDirectory[] };
}

export function parseLevelTable(document: unknown): LevelTable {
  const table = record(document, "table");
  const rawLevels = table["levels"];
  if (!Array.isArray(rawLevels) || rawLevels.length === 0) {
    throw new LevelTableError("The level table lists no levels");
  }
  const parsed = rawLevels.map((raw) => {
    const level = record(raw, "level");
    const stored = record(level["stored"], "stored size");
    return {
      level: {
        downsample: positive(level["downsample"], "downsample"),
        width: positive(level["width"], "width"),
        height: positive(level["height"], "height"),
        stored: {
          width: positive(stored["width"], "stored width"),
          height: positive(stored["height"], "stored height"),
        },
      },
      directory: locatedLevel(level),
    };
  });
  const everyLocated = parsed.every(({ directory }) => directory !== null);
  const levels = parsed.map(
    ({ level, directory }): LevelTableLevel =>
      everyLocated && directory !== null ? { ...level, directory } : level,
  );
  const scale = table["scale"] === undefined ? {} : record(table["scale"], "scale");
  const x = optionalMicrons(scale["mpp_x"]);
  const y = optionalMicrons(scale["mpp_y"]);
  return {
    levels,
    micronsPerPixel: x === null || y === null ? null : { x, y },
    header: headerOf(table),
  };
}

export function slideIndexFromLevelTable(table: LevelTable, formatId: SlideFormatId): SlideIndex {
  const levels: SlideIndexLevel[] = table.levels.map((level) => ({
    stored: level.stored,
    downsample: level.downsample,
    width: level.width,
    height: level.height,
    ...(level.directory === undefined ? {} : level.directory),
  }));
  return {
    formatId,
    levels,
    ...(table.micronsPerPixel === null ? {} : { micronsPerPixel: table.micronsPerPixel }),
    ...(table.header ?? {}),
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

async function sidecarDocument(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzipped) return JSON.parse(new TextDecoder().decode(bytes));
  const inflated = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(inflated).json();
}

async function withFrameStitching(
  table: SlideIndex,
  sidecarUrl: string,
  options: SignedSlideOptions,
): Promise<SlideIndex> {
  const { access, fetcher, signal } = options;
  const response = await access.fetch(sidecarUrl, signal === undefined ? {} : { signal }, fetcher);
  if (response.status === 404) throw new SlideNeedsReingestError(sidecarUrl);
  if (!response.ok) throw new SlideBytesError(sidecarUrl, response.status);
  const document = await sidecarDocument(response);
  const stitching = frameStitchingOf(document);
  if (stitching !== null) return { ...table, tileKind: "bif-frames", stitching };
  if (unplacedReasonOf(document) === "several-scan-areas") {
    throw new SlideHasSeveralScanAreasError(sidecarUrl);
  }
  throw new SlideNeedsReingestError(sidecarUrl);
}

function unplacedReasonOf(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return null;
  return (document as Record<string, unknown>)["unplaced"];
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
  const restricted = restrictedRangesOf(await access.token(), original);
  return {
    formatId,
    url,
    index,
    fetch: (input, init) => access.fetch(requestUrl(input), init, fetcher),
    ...(restricted.length === 0 ? {} : { restricted }),
  };
}

function isByteRange(value: unknown): value is RestrictedRange {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => Number.isSafeInteger(part) && part >= 0) &&
    value[0] < value[1]
  );
}

export function restrictedRangesOf(token: string, original: string): RestrictedRange[] {
  const [payload = ""] = token.split(".");
  try {
    const text = atob(payload.replaceAll("-", "+").replaceAll("_", "/"));
    const json = new TextDecoder().decode(Uint8Array.from(text, (char) => char.charCodeAt(0)));
    const claims = JSON.parse(json) as Record<string, unknown>;
    const ranges = claims["d"];
    if (claims["o"] !== original || !Array.isArray(ranges)) return [];
    return ranges.every(isByteRange) ? ranges : [];
  } catch {
    return [];
  }
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
