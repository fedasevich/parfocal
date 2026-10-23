import { openTiffSource } from "./tiff/tiff-source.ts";
import {
  type OpenRequest,
  type PixelSource,
  type PixelSourceOpener,
  type SlideFormatId,
  UnsupportedFormatError,
} from "./types.ts";
import { openOmeZarrSource } from "./zarr/ome-zarr-source.ts";

export interface PixelSourceRegistry {
  register(formatIds: readonly SlideFormatId[], opener: PixelSourceOpener): void;
  supports(formatId: string): formatId is SlideFormatId;
  open(request: OpenRequest): Promise<PixelSource>;
}

export function createPixelSourceRegistry(): PixelSourceRegistry {
  const openers = new Map<string, PixelSourceOpener>();
  return {
    register(formatIds, opener) {
      for (const formatId of formatIds) openers.set(formatId, opener);
    },
    supports(formatId): formatId is SlideFormatId {
      return openers.has(formatId);
    },
    async open(request) {
      if (request.index !== undefined && request.index.formatId !== request.formatId) {
        throw new Error(
          `The slide index is for ${request.index.formatId}, but the slide was opened as ${request.formatId}`,
        );
      }
      const opener = openers.get(request.formatId);
      if (opener === undefined) throw new UnsupportedFormatError(request.formatId);
      return opener(request);
    },
  };
}

export const tiffTileGridFormats = [
  "generic-tiff",
  "ome-tiff",
  "aperio-svs",
  "philips-tiff",
  "huron-tiff",
  "argos-avs",
  "leica-scn",
] as const satisfies readonly SlideFormatId[];

export function createDefaultPixelSourceRegistry(): PixelSourceRegistry {
  const registry = createPixelSourceRegistry();
  registry.register(tiffTileGridFormats, openTiffSource);
  registry.register(["ome-zarr"], openOmeZarrSource);
  return registry;
}
