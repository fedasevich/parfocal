import type {
  OverviewLevelsRef,
  PixelLevel,
  PixelSource,
  RasterRequest,
  TileRequest,
} from "./types.ts";

export class OverviewLevelsMismatchError extends Error {
  constructor(reason: string) {
    super(`The overview levels do not fit the slide: ${reason}`);
    this.name = "OverviewLevelsMismatchError";
  }
}

function checkedLevels(
  main: PixelSource,
  overview: PixelSource,
  reference: OverviewLevelsRef,
): PixelLevel[] {
  const [base] = main.levels;
  const coarsest = main.levels.at(-1);
  if (base === undefined || coarsest === undefined) {
    throw new OverviewLevelsMismatchError("the slide has no levels");
  }
  if (overview.levels.length !== reference.downsamples.length) {
    throw new OverviewLevelsMismatchError(
      `the file has ${overview.levels.length} levels for ${reference.downsamples.length} downsamples`,
    );
  }
  return overview.levels.map((level, index) => {
    const downsample = reference.downsamples[index] ?? 0;
    const width = Math.ceil(base.width / downsample);
    const height = Math.ceil(base.height / downsample);
    if (downsample <= coarsest.downsample) {
      throw new OverviewLevelsMismatchError(
        `downsample ${downsample} is not coarser than the slide's ${coarsest.downsample}`,
      );
    }
    if (level.width !== width || level.height !== height) {
      throw new OverviewLevelsMismatchError(
        `level ${index} is ${level.width}x${level.height}, not ${width}x${height}`,
      );
    }
    return { ...level, downsample };
  });
}

export function withOverviewLevels(
  main: PixelSource,
  overview: PixelSource,
  reference: OverviewLevelsRef,
): PixelSource {
  if (
    overview.photometric !== main.photometric ||
    overview.dtype !== main.dtype ||
    overview.channels.length !== main.channels.length
  ) {
    throw new OverviewLevelsMismatchError("the pixel layout differs from the slide");
  }
  const derived = checkedLevels(main, overview, reference);
  const own = main.levels.length;
  const route = <T extends TileRequest | RasterRequest>(request: T): [PixelSource, T] =>
    request.level < own ? [main, request] : [overview, { ...request, level: request.level - own }];
  const composed: PixelSource = {
    formatId: main.formatId,
    levels: [...main.levels, ...derived],
    tileSize: main.tileSize,
    micronsPerPixel: main.micronsPerPixel,
    photometric: main.photometric,
    dtype: main.dtype,
    channels: main.channels,
    getTile: (request) => {
      const [source, routed] = route(request);
      return source.getTile(routed);
    },
    getRaster: (request) => {
      const [source, routed] = route(request);
      return source.getRaster(routed);
    },
    close: () => {
      overview.close();
      main.close();
    },
  };
  const report = main.decodeReport?.bind(main);
  return report === undefined ? composed : { ...composed, decodeReport: report };
}
