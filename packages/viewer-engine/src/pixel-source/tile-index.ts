import {
  type SlideIndex,
  type SlideIndexLevel,
  type SlideIndexPage,
  slideFormatIds,
  type TileRun,
} from "./types.ts";

export const TILE_INDEX_FILE = "tile-index.json";
export const TILE_INDEX_VERSION = 1;

export class TileIndexError extends Error {
  constructor(reason: string) {
    super(`The tile index is unusable: ${reason}`);
    this.name = "TileIndexError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function checkPage(page: unknown, where: string): void {
  if (!isRecord(page)) throw new TileIndexError(`${where} is not an object`);
  if (typeof page.page !== "number") throw new TileIndexError(`${where} has no page number`);
  if (typeof page.ifdOffset !== "number")
    throw new TileIndexError(`${where} has no directory offset`);
  const { tileOffsetGaps, tileByteCounts } = page;
  if (!isNumberList(tileOffsetGaps) || !isNumberList(tileByteCounts))
    throw new TileIndexError(`${where} has no tile table`);
  if (tileOffsetGaps.length !== tileByteCounts.length)
    throw new TileIndexError(
      `${where} has ${tileOffsetGaps.length} offsets for ${tileByteCounts.length} tiles`,
    );
}

function isRunList(value: unknown): value is TileRun[] {
  return (
    Array.isArray(value) &&
    value.every(
      (run: unknown) =>
        Array.isArray(run) &&
        run.length === 2 &&
        run.every((part: unknown) => Number.isInteger(part) && (part as number) >= 0),
    )
  );
}

export function readTileIndex(document: unknown): SlideIndex {
  if (!isRecord(document)) throw new TileIndexError("not an object");
  if (document.version !== TILE_INDEX_VERSION)
    throw new TileIndexError(`version ${String(document.version)} is not ${TILE_INDEX_VERSION}`);
  const formatId = document.formatId;
  if (typeof formatId !== "string" || !(slideFormatIds as readonly string[]).includes(formatId))
    throw new TileIndexError(`unknown format ${String(formatId)}`);
  const levels = document.levels;
  if (!Array.isArray(levels) || levels.length === 0) throw new TileIndexError("no levels");
  levels.forEach((level: unknown, index) => {
    if (formatId !== "ome-zarr") checkPage(level, `level ${index}`);
    const absent = isRecord(level) ? level.absentTiles : undefined;
    if (absent !== undefined && !isRunList(absent))
      throw new TileIndexError(`level ${index} has a malformed absence map`);
    const sizes = isRecord(level) ? [level.downsample, level.width, level.height] : [];
    if (!sizes.every((size) => typeof size === "number" && size > 0))
      throw new TileIndexError(`level ${index} has no size`);
    const siblings = isRecord(level) ? level.siblings : undefined;
    if (siblings !== undefined && !Array.isArray(siblings))
      throw new TileIndexError(`level ${index} has malformed siblings`);
    siblings?.forEach((sibling: unknown, at: number) => {
      checkPage(sibling, `level ${index} sibling ${at}`);
    });
  });
  return document as unknown as SlideIndex;
}

export function tileOffsets(page: SlideIndexPage): number[] | null {
  const gaps = page.tileOffsetGaps;
  const counts = page.tileByteCounts;
  if (gaps === undefined || counts === undefined || gaps.length !== counts.length) return null;
  let end = 0;
  return gaps.map((gap, index) => {
    const offset = end + gap;
    end = offset + (counts[index] ?? 0);
    return offset;
  });
}

export function locatesEveryDirectory(levels: readonly SlideIndexLevel[] | undefined): boolean {
  return (
    levels !== undefined &&
    levels.length > 0 &&
    levels.every(
      (level) =>
        level.ifdOffset !== undefined &&
        (level.siblings ?? []).every((sibling) => sibling.ifdOffset !== undefined),
    )
  );
}

export function isAbsentTile(runs: readonly TileRun[] | undefined, tile: number): boolean {
  if (runs === undefined) return false;
  let low = 0;
  let high = runs.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, length] = runs[middle] ?? [0, 0];
    if (tile < start) high = middle - 1;
    else if (tile >= start + length) low = middle + 1;
    else return true;
  }
  return false;
}
