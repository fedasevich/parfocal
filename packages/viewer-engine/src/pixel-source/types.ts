export const slideFormatIds = [
  "aperio-svs",
  "hamamatsu-ndpi",
  "leica-scn",
  "ventana-bif",
  "philips-tiff",
  "huron-tiff",
  "argos-avs",
  "ome-tiff",
  "generic-tiff",
  "mirax",
  "dicom",
  "ome-zarr",
] as const;

export type SlideFormatId = (typeof slideFormatIds)[number];

export type PixelDtype =
  | "uint8"
  | "uint16"
  | "uint32"
  | "int8"
  | "int16"
  | "int32"
  | "float32"
  | "float64";

export type PixelArray =
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Float32Array
  | Float64Array;

export type Photometric = "rgb" | "grey" | "channels";

export interface ChannelInfo {
  readonly name: string;
  readonly color: readonly [number, number, number] | null;
  readonly window: readonly [number, number] | null;
}

export interface PixelLevel {
  readonly downsample: number;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}

export interface MicronsPerPixel {
  readonly x: number;
  readonly y: number;
}

export type PixelWindow = readonly [x0: number, y0: number, x1: number, y1: number];

export interface Raster {
  readonly absent: false;
  readonly width: number;
  readonly height: number;
  readonly planes: readonly PixelArray[];
}

export interface AbsentRaster {
  readonly absent: true;
  readonly width: number;
  readonly height: number;
}

export type PixelResult = Raster | AbsentRaster;

export interface TileRequest {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly signal?: AbortSignal;
}

export interface RasterRequest {
  readonly level: number;
  readonly window?: PixelWindow;
  readonly signal?: AbortSignal;
}

export interface PixelSource {
  readonly formatId: SlideFormatId;
  readonly levels: readonly PixelLevel[];
  readonly tileSize: { readonly width: number; readonly height: number };
  readonly micronsPerPixel: MicronsPerPixel | null;
  readonly photometric: Photometric;
  readonly dtype: PixelDtype;
  readonly channels: readonly ChannelInfo[];
  getTile(request: TileRequest): Promise<PixelResult>;
  getRaster(request: RasterRequest): Promise<PixelResult>;
  close(): void;
}

export interface SlideIndexLevel {
  readonly page: number;
  readonly downsample: number;
  readonly width: number;
  readonly height: number;
}

export interface SlideIndex {
  readonly formatId: SlideFormatId;
  readonly levels?: readonly SlideIndexLevel[];
  readonly micronsPerPixel?: MicronsPerPixel | null;
  readonly zarrVersion?: 2 | 3;
}

export interface OpenRequest {
  readonly formatId: SlideFormatId;
  readonly url: string | URL;
  readonly baseUrl?: string | URL;
  readonly index?: SlideIndex;
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export type PixelSourceOpener = (request: OpenRequest) => Promise<PixelSource>;

export class UnsupportedFormatError extends Error {
  readonly formatId: string;

  constructor(formatId: string) {
    super(`No pixel source is registered for the format "${formatId}"`);
    this.name = "UnsupportedFormatError";
    this.formatId = formatId;
  }
}

export class UnsupportedCodecError extends Error {
  readonly compression: number;

  constructor(compression: number) {
    super(`The browser reader has no decoder for TIFF compression ${compression}`);
    this.name = "UnsupportedCodecError";
    this.compression = compression;
  }
}

export class SourceClosedError extends Error {
  constructor() {
    super("The pixel source is closed");
    this.name = "SourceClosedError";
  }
}
